'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppContext, getMembers, getCurrentUser, setCurrentUser, getToday, DEFAULT_MEMBERS, DEFAULT_TASKS, DEFAULT_TASK_RESOURCES, STORAGE_KEYS, SYNC_KEYS, setFirestoreSyncReady, performUndo, runTaskMigration } from '@/lib/store';

// Deep-merge two nested objects. LOCAL wins at every leaf (local data is assumed to be newer).
// Used for actualPerformance and actualTimeline so that home screen entries are never overwritten by stale Firestore data.
function mergeNestedObjects(localData: unknown, remoteData: unknown): unknown {
  if (typeof localData !== 'object' || localData === null || Array.isArray(localData)) return localData;
  if (typeof remoteData !== 'object' || remoteData === null || Array.isArray(remoteData)) return localData;
  const result = { ...(remoteData as Record<string, unknown>) };
  for (const [key, val] of Object.entries(localData as Record<string, unknown>)) {
    if (key in result && typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = mergeNestedObjects(val, result[key]);
    } else {
      result[key] = val; // local wins
    }
  }
  return result;
}

// Merge two arrays of records by `id`. Returns null if either side is not an array of objects with id.
// On collision (same id in both), prefers the LOCAL record (assumed to be a more recent edit).
// This recovers local-only records that haven't been synced yet, while preserving Firestore's complete dataset.
function mergeArraysById(localData: unknown, remoteData: unknown): unknown[] | null {
  if (!Array.isArray(localData) || !Array.isArray(remoteData)) return null;
  // Both must be arrays of objects with `id` to merge
  if (localData.length > 0 && (typeof localData[0] !== 'object' || localData[0] === null || !('id' in localData[0]))) return null;
  if (remoteData.length > 0 && (typeof remoteData[0] !== 'object' || remoteData[0] === null || !('id' in remoteData[0]))) return null;
  const merged = new Map<string, unknown>();
  // Add remote first
  for (const item of remoteData as Array<{ id?: string }>) {
    if (item?.id) merged.set(item.id, item);
  }
  // Local overrides remote on id collision (newer local edits take precedence)
  for (const item of localData as Array<{ id?: string }>) {
    if (item?.id) merged.set(item.id, item);
  }
  return Array.from(merged.values());
}
import { db } from '@/lib/firebase';
import { doc, onSnapshot, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ensureDailyBackup } from '@/lib/backup';
import type { Member } from '@/lib/types';

// Per-user 3階層データ（actualPerformance / actualTimeline）の差分を
// Firestore のフィールドパス更新マップに変換するヘルパー。
// 構造: Record<date, Record<memberId, Record<taskName|blockIdx, value>>>
// LOCAL と REMOTE を比較し、leaf レベルで違う or LOCAL にしかないエントリだけを抽出。
// 戻り値の例: { 'value.2026-05-29.kunigane.【LINE】画像査定': {count, points}, ... }
function buildPerUserFieldUpdates(
  local: unknown,
  remote: unknown,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (typeof local !== 'object' || local === null) return updates;
  const localObj = local as Record<string, Record<string, Record<string, unknown>>>;
  const remoteObj = (typeof remote === 'object' && remote !== null)
    ? (remote as Record<string, Record<string, Record<string, unknown>>>)
    : {};
  for (const [date, localMembers] of Object.entries(localObj)) {
    if (typeof localMembers !== 'object' || localMembers === null) continue;
    const remoteMembers = remoteObj[date] || {};
    for (const [memberId, localLeaves] of Object.entries(localMembers)) {
      if (typeof localLeaves !== 'object' || localLeaves === null) continue;
      const remoteLeaves = remoteMembers[memberId] || {};
      for (const [leafKey, localValue] of Object.entries(localLeaves)) {
        const remoteValue = remoteLeaves[leafKey];
        // leaf値が違う or remote に無い場合だけ書き戻し対象
        if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
          updates[`value.${date}.${memberId}.${leafKey}`] = localValue;
        }
      }
    }
  }
  return updates;
}

// 「他人のデータに絶対に触れない」write-back 関数。
// updateDoc + フィールドパスで差分のみ書き込む（全体上書きはしない）。
// ドキュメント未存在の場合のみ、最終フォールバックとして setDoc を1回実行。
async function writeBackPerUserDiff(
  key: string,
  merged: unknown,
  remote: unknown,
): Promise<void> {
  const updates = buildPerUserFieldUpdates(merged, remote);
  if (Object.keys(updates).length === 0) return; // 差分なし
  try {
    await updateDoc(doc(db, 'appData', key), {
      ...updates,
      updatedAt: Date.now(),
    });
  } catch (err) {
    // 通常はドキュメント未存在エラー。その場合のみ初回 setDoc を実行
    try {
      await setDoc(doc(db, 'appData', key), { value: merged, updatedAt: Date.now() });
    } catch (err2) {
      console.warn(`[Firestore] writeBackPerUserDiff fallback failed for "${key}":`, err2);
    }
    void err;
  }
}

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUserId, setCurrentUserIdState] = useState('');
  const [members, setMembersState] = useState<Member[]>(DEFAULT_MEMBERS);
  const [dataVersion, setDataVersion] = useState(0);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDateState] = useState(getToday());

  // Restore selectedDate from localStorage on mount so it's shared across pages and reloads
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('schedule_selected_date');
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        setSelectedDateState(saved);
      }
    } catch { /* ignore */ }
  }, []);

  // Auth guard: 未ログイン時は /login へ遷移（/login と / は例外）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const userId = getCurrentUser();
    const isAuthPage = pathname === '/login' || pathname === '/';
    if (!userId && !isAuthPage) {
      router.push('/login');
    }
  }, [pathname, currentUserId, router]);

  useEffect(() => {
    setCurrentUserIdState(getCurrentUser());

    // Initialize Firestore: smart merge so unsynced local data isn't lost
    async function initFirestore() {
      try {
        const timeoutPromise = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000));
        const firestorePromise = (async () => {
          // Step 1: SMART MERGE — for each key, compare localStorage vs Firestore
          //   - If both exist: merge by id (for arrays of records). Push merged back to Firestore.
          //     This RECOVERS local-only data that earlier failed to sync (e.g. from old buggy code).
          //   - If only Firestore exists: write to localStorage
          //   - If only localStorage exists: push to Firestore
          for (const key of SYNC_KEYS) {
            const snap = await getDoc(doc(db, 'appData', key));
            const remoteExists = snap.exists();
            const remoteData = remoteExists ? snap.data().value : null;
            const localRaw = localStorage.getItem(key);
            let localData: unknown = null;
            try { localData = localRaw ? JSON.parse(localRaw) : null; } catch { localData = null; }

            if (remoteExists && localData) {
              // Both have data → merge if both are arrays (typical for record collections)
              const merged = mergeArraysById(localData, remoteData);
              if (merged !== null) {
                // Detect if there are local-only records (need to push back)
                const remoteIds = new Set((remoteData as Array<{ id?: string }> | null)?.map(r => r?.id).filter(Boolean) || []);
                const localOnlyExists = Array.isArray(localData)
                  && (localData as Array<{ id?: string }>).some(r => r?.id && !remoteIds.has(r.id));
                if (localOnlyExists) {
                  console.log(`[Firestore] Recovering local-only records for "${key}"`);
                  await setDoc(doc(db, 'appData', key), { value: merged, updatedAt: Date.now() });
                }
                localStorage.setItem(key, JSON.stringify(merged));
                if (key === STORAGE_KEYS.members) setMembersState(merged as Member[]);
              } else {
                // Nested-object stores (timeline / actualTimeline / actualPerformance / taskAssignments /
                // fixedTaskDefaults etc.) → deep-merge so locally-written data is never overwritten
                // by a race with concurrent Firestore sync. Local values win on key collision.
                const deepMerged = mergeNestedObjects(localData, remoteData);
                localStorage.setItem(key, JSON.stringify(deepMerged));
                await setDoc(doc(db, 'appData', key), { value: deepMerged, updatedAt: Date.now() });
              }
            } else if (remoteExists) {
              // Only Firestore has data → pull
              localStorage.setItem(key, JSON.stringify(remoteData));
              if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
            } else if (localData) {
              // Only localStorage has data → push to Firestore
              console.log(`[Firestore] Pushing initial data for "${key}"`);
              await setDoc(doc(db, 'appData', key), { value: localData, updatedAt: Date.now() });
            }
          }

          // Step 2: Seed defaults only for keys that don't exist in Firestore
          const defaults: [string, unknown][] = [
            [STORAGE_KEYS.members, DEFAULT_MEMBERS],
            [STORAGE_KEYS.tasks, DEFAULT_TASKS],
            [STORAGE_KEYS.taskResources, DEFAULT_TASK_RESOURCES],
          ];
          for (const [key, defaultVal] of defaults) {
            const snap = await getDoc(doc(db, 'appData', key));
            if (!snap.exists()) {
              await setDoc(doc(db, 'appData', key), { value: defaultVal, updatedAt: Date.now() });
              localStorage.setItem(key, JSON.stringify(defaultVal));
            }
          }

          return 'done' as const;
        })();

        const result = await Promise.race([firestorePromise, timeoutPromise]);
        if (result === 'timeout') {
          console.warn('Firestore init timed out, continuing in background');
        }
        setFirestoreReady(true);
      } catch (err) {
        console.error('Firestore init error:', err);
        setFirestoreReady(true);
      }

      // Now read members from localStorage (which now has Firestore data)
      const loadedMembers = getMembers();
      setMembersState(loadedMembers);

      // Enable Firestore writes now that we have loaded remote data
      setFirestoreSyncReady(true);

      // Run one-time task name migration (renames old task names → new)
      try {
        const migrated = runTaskMigration();
        if (migrated) {
          console.log('Task name migration applied');
          setDataVersion(v => v + 1);
        }
      } catch (err) {
        console.error('Task migration error:', err);
      }

      // Trigger daily Firestore snapshot (idempotent, skips if today's backup exists)
      ensureDailyBackup().catch(err => console.warn('[Backup] init error:', err));

      setLoading(false);
    }
    initFirestore();
  }, []);

  // Subscribe to Firestore changes from other users
  useEffect(() => {
    if (!firestoreReady) return;

    // Per-user nested-object stores: each user owns a different memberId key,
    // so deep-merge prevents losing other users' concurrent inputs.
    const PER_USER_NESTED_KEYS = new Set<string>([
      STORAGE_KEYS.actualPerformance,
      STORAGE_KEYS.actualTimeline,
    ]);
    // Keyed-by-id object stores in Firestore (each PC owns different record IDs).
    // 受信時はオブジェクト → 配列に変換して localStorage に保存し、
    // 既存のローカル配列と mergeArraysById で統合する。
    const KEYED_OBJECT_KEYS = new Set<string>([
      STORAGE_KEYS.shippingRecords,
    ]);

    const unsubs = [...SYNC_KEYS].map(key =>
      onSnapshot(doc(db, 'appData', key), (snap) => {
        if (!snap.exists()) return;
        // Skip only Firestore's own echo of OUR optimistic write (built-in guard).
        // Apply ALL other remote updates immediately — this guarantees other users' edits
        // propagate to every PC within seconds.
        if (snap.metadata.hasPendingWrites) return;

        const remoteData = snap.data().value;
        const localRaw = localStorage.getItem(key);

        // Keyed-by-id object format (e.g., schedule_shipping)
        // Firestore stores as { [id]: record }, local stores as array.
        // 受信時：オブジェクト→配列に変換、ローカルとマージ
        if (KEYED_OBJECT_KEYS.has(key)) {
          let localArray: unknown[] = [];
          try {
            const parsed = localRaw ? JSON.parse(localRaw) : [];
            if (Array.isArray(parsed)) localArray = parsed;
            else if (parsed && typeof parsed === 'object') localArray = Object.values(parsed);
          } catch { localArray = []; }

          let remoteArray: unknown[] = [];
          if (Array.isArray(remoteData)) {
            remoteArray = remoteData;
          } else if (remoteData && typeof remoteData === 'object') {
            remoteArray = Object.values(remoteData as Record<string, unknown>);
          }

          const merged = mergeArraysById(localArray, remoteArray);
          const finalArray = merged ?? remoteArray;
          const finalStr = JSON.stringify(finalArray);
          if (finalStr !== localRaw) {
            localStorage.setItem(key, finalStr);
            setDataVersion(v => v + 1);
          }
          return;
        }

        if (PER_USER_NESTED_KEYS.has(key)) {
          // Per-user nested data: deep-merge to preserve concurrent edits across users
          let localData: unknown = null;
          try { localData = localRaw ? JSON.parse(localRaw) : null; } catch { localData = null; }
          const merged = localData ? mergeNestedObjects(localData, remoteData) : remoteData;
          const mergedStr = JSON.stringify(merged);
          const remoteStr = JSON.stringify(remoteData);
          if (mergedStr !== localRaw) {
            localStorage.setItem(key, mergedStr);
            setDataVersion(v => v + 1);
          }
          // BUG FIX: If merge produced data beyond what's on remote (= local had unique entries
          // that Firestore lost in a previous race), push only the differing field-paths so other
          // users' data is NEVER touched. updateDoc with dot-notation paths guarantees per-leaf isolation.
          if (mergedStr !== remoteStr) {
            writeBackPerUserDiff(key, merged, remoteData)
              .catch(err => console.warn(`[Firestore] write-back diff failed for "${key}":`, err));
          }
        } else {
          // Shared data: apply remote as the truth. Re-render only if value changed.
          const remoteStr = JSON.stringify(remoteData);
          if (remoteStr !== localRaw) {
            localStorage.setItem(key, remoteStr);
            if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
            setDataVersion(v => v + 1);
          }
        }
      })
    );

    return () => unsubs.forEach(u => u());
  }, [firestoreReady]);

  // Force refresh: pull from Firestore (remote-as-truth), skip keys with pending local writes
  const forceRefresh = useCallback(async () => {
    try {
      const PER_USER_NESTED_KEYS = new Set<string>([
        STORAGE_KEYS.actualPerformance,
        STORAGE_KEYS.actualTimeline,
      ]);

      let changed = false;
      for (const key of SYNC_KEYS) {
        const snap = await getDoc(doc(db, 'appData', key));
        const remoteExists = snap.exists();
        const remoteData = remoteExists ? snap.data().value : null;
        const localRaw = localStorage.getItem(key);
        let localData: unknown = null;
        try { localData = localRaw ? JSON.parse(localRaw) : null; } catch { localData = null; }

        if (!remoteExists) {
          if (localData) {
            console.log(`[Firestore] forceRefresh: pushing local to empty remote "${key}"`);
            await setDoc(doc(db, 'appData', key), { value: localData, updatedAt: Date.now() });
          }
          continue;
        }

        if (PER_USER_NESTED_KEYS.has(key)) {
          const merged = localData ? mergeNestedObjects(localData, remoteData) : remoteData;
          const mergedStr = JSON.stringify(merged);
          const remoteStr = JSON.stringify(remoteData);
          if (mergedStr !== localRaw) {
            localStorage.setItem(key, mergedStr);
            changed = true;
          }
          // BUG FIX: write merged back to Firestore so it converges to the union of all PCs' edits.
          // 差分のみフィールドパスで更新 → 他人のデータには絶対に触れない。
          if (mergedStr !== remoteStr) {
            await writeBackPerUserDiff(key, merged, remoteData);
          }
        } else {
          const remoteStr = JSON.stringify(remoteData);
          if (remoteStr !== localRaw) {
            localStorage.setItem(key, remoteStr);
            if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
            changed = true;
          }
        }
      }
      if (changed) setDataVersion(v => v + 1);
    } catch (err) {
      console.error('Force refresh error:', err);
    }
  }, []);

  // Auto-refresh when user returns to the tab (visibilitychange)
  useEffect(() => {
    if (!firestoreReady) return;
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        forceRefresh();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [firestoreReady, forceRefresh]);

  // Auto-refresh when network reconnects
  useEffect(() => {
    if (!firestoreReady) return;
    function handleOnline() { forceRefresh(); }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [firestoreReady, forceRefresh]);

  // Periodic refresh every 15 seconds (with auto-merge to recover unsynced data)
  useEffect(() => {
    if (!firestoreReady) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        forceRefresh();
      }
    }, 15_000); // 15 seconds
    return () => clearInterval(interval);
  }, [firestoreReady, forceRefresh]);

  // Refresh on every route change (when user navigates between pages)
  useEffect(() => {
    if (!firestoreReady) return;
    forceRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, firestoreReady]);

  // Global Ctrl+Z / Cmd+Z undo handler
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        // Ignore if user is typing in an input/textarea (browser native undo)
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        const ok = performUndo();
        if (ok) setDataVersion(v => v + 1);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Listen to undo-triggered data updates
  useEffect(() => {
    function handleUpdated() { setDataVersion(v => v + 1); }
    window.addEventListener('schedule-data-updated', handleUpdated);
    return () => window.removeEventListener('schedule-data-updated', handleUpdated);
  }, []);

  const handleSetCurrentUserId = useCallback((id: string) => {
    setCurrentUserIdState(id);
    setCurrentUser(id);
  }, []);

  const handleSetSelectedDate = useCallback((date: string) => {
    setSelectedDateState(date);
    // Persist to localStorage so both pages (and reloads) share the same date
    try { if (typeof window !== 'undefined') localStorage.setItem('schedule_selected_date', date); } catch { /* ignore */ }
  }, []);

  const refreshMembers = useCallback(() => {
    setMembersState(getMembers());
  }, []);

  // Login page and root page don't need Firestore - render immediately
  const skipLoading = pathname === '/login' || pathname === '/';
  if (loading && !skipLoading) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-green-700 font-medium">データを読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={{
      currentUserId,
      setCurrentUserId: handleSetCurrentUserId,
      members,
      refreshMembers,
      dataVersion,
      firestoreReady,
      selectedDate,
      setSelectedDate: handleSetSelectedDate,
      forceRefresh,
    }}>
      {children}
    </AppContext.Provider>
  );
}
