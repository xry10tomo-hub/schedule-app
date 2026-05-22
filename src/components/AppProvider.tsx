'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
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
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import type { Member } from '@/lib/types';

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
              } else if (key === STORAGE_KEYS.actualPerformance || key === STORAGE_KEYS.actualTimeline) {
                // Nested-object stores: deep-merge so locally-entered data isn't overwritten
                const deepMerged = mergeNestedObjects(localData, remoteData);
                localStorage.setItem(key, JSON.stringify(deepMerged));
                // Push merged data back to Firestore so remote stays up to date
                await setDoc(doc(db, 'appData', key), { value: deepMerged, updatedAt: Date.now() });
              } else {
                // Not mergeable (object, not array) → use Firestore as source of truth
                localStorage.setItem(key, JSON.stringify(remoteData));
                if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
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

      setLoading(false);
    }
    initFirestore();
  }, []);

  // Subscribe to Firestore changes from other users
  useEffect(() => {
    if (!firestoreReady) return;

    const unsubs = [...SYNC_KEYS].map(key =>
      onSnapshot(doc(db, 'appData', key), (snap) => {
        // Only apply remote changes (skip our own writes)
        if (snap.exists() && !snap.metadata.hasPendingWrites) {
          const remoteData = snap.data().value;
          if (key === STORAGE_KEYS.actualPerformance || key === STORAGE_KEYS.actualTimeline) {
            // Deep-merge so that locally-entered data isn't overwritten by a remote snapshot
            const localRaw = localStorage.getItem(key);
            let localData: unknown = null;
            try { localData = localRaw ? JSON.parse(localRaw) : null; } catch { localData = null; }
            const merged = localData ? mergeNestedObjects(localData, remoteData) : remoteData;
            localStorage.setItem(key, JSON.stringify(merged));
          } else {
            localStorage.setItem(key, JSON.stringify(remoteData));
            if (key === STORAGE_KEYS.members) {
              setMembersState(remoteData as Member[]);
            }
          }
          setDataVersion(v => v + 1);
        }
      })
    );

    return () => unsubs.forEach(u => u());
  }, [firestoreReady]);

  // Force refresh: smart merge between Firestore and local (rescues unsynced records)
  const forceRefresh = useCallback(async () => {
    try {
      for (const key of SYNC_KEYS) {
        const snap = await getDoc(doc(db, 'appData', key));
        const remoteExists = snap.exists();
        const remoteData = remoteExists ? snap.data().value : null;
        const localRaw = localStorage.getItem(key);
        let localData: unknown = null;
        try { localData = localRaw ? JSON.parse(localRaw) : null; } catch { localData = null; }

        if (remoteExists && localData) {
          const merged = mergeArraysById(localData, remoteData);
          if (merged !== null) {
            const remoteIds = new Set((remoteData as Array<{ id?: string }> | null)?.map(r => r?.id).filter(Boolean) || []);
            const localOnlyExists = Array.isArray(localData)
              && (localData as Array<{ id?: string }>).some(r => r?.id && !remoteIds.has(r.id));
            if (localOnlyExists) {
              console.log(`[Firestore] forceRefresh: recovering local-only records for "${key}"`);
              await setDoc(doc(db, 'appData', key), { value: merged, updatedAt: Date.now() });
            }
            localStorage.setItem(key, JSON.stringify(merged));
            if (key === STORAGE_KEYS.members) setMembersState(merged as Member[]);
          } else if (key === STORAGE_KEYS.actualPerformance || key === STORAGE_KEYS.actualTimeline) {
            // Nested-object stores: deep-merge so locally-entered data isn't overwritten by 15s refresh
            const deepMerged = mergeNestedObjects(localData, remoteData);
            localStorage.setItem(key, JSON.stringify(deepMerged));
            // Push merged data back to Firestore so remote stays up to date
            await setDoc(doc(db, 'appData', key), { value: deepMerged, updatedAt: Date.now() });
          } else {
            // Not array-of-id (e.g., timeline/perf objects keyed by date) → use Firestore as truth
            localStorage.setItem(key, JSON.stringify(remoteData));
            if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
          }
        } else if (remoteExists) {
          localStorage.setItem(key, JSON.stringify(remoteData));
          if (key === STORAGE_KEYS.members) setMembersState(remoteData as Member[]);
        } else if (localData) {
          // Firestore is empty for this key but local has data → push it
          console.log(`[Firestore] forceRefresh: pushing local data to empty remote "${key}"`);
          await setDoc(doc(db, 'appData', key), { value: localData, updatedAt: Date.now() });
        }
      }
      setDataVersion(v => v + 1);
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
