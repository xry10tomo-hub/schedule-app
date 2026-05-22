import { db } from './firebase';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { SYNC_KEYS } from './store';

const BACKUP_COLLECTION = 'appDataBackups';
const RETENTION_DAYS = 30;
const LAST_BACKUP_CHECK_KEY = 'schedule_last_backup_check';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ensures a daily snapshot exists for today.
 * Snapshots ALL SYNC_KEYS from Firestore into appDataBackups/{YYYY-MM-DD}.
 * Read-only on existing backups: idempotent if called multiple times in one day.
 * Also prunes backups older than RETENTION_DAYS.
 * Lightweight: checks a localStorage flag to skip work if already attempted today.
 */
export async function ensureDailyBackup(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const today = todayStr();

    // Skip if we already checked today (in this browser)
    const lastCheck = localStorage.getItem(LAST_BACKUP_CHECK_KEY);
    if (lastCheck === today) return;

    const backupRef = doc(db, BACKUP_COLLECTION, today);
    const existingBackup = await getDoc(backupRef);

    if (!existingBackup.exists()) {
      // Snapshot all SYNC_KEYS into one doc
      const snapshot: Record<string, unknown> = {};
      for (const key of SYNC_KEYS) {
        const snap = await getDoc(doc(db, 'appData', key));
        if (snap.exists()) snapshot[key] = snap.data().value;
      }
      await setDoc(backupRef, {
        value: snapshot,
        createdAt: Date.now(),
      });
      console.log(`[Backup] Created daily backup for ${today}`);
    }

    localStorage.setItem(LAST_BACKUP_CHECK_KEY, today);

    // Cleanup old backups (best-effort)
    pruneOldBackups().catch(err => console.warn('[Backup] Prune error:', err));
  } catch (err) {
    console.error('[Backup] ensureDailyBackup error:', err);
  }
}

async function pruneOldBackups(): Promise<void> {
  const all = await getDocs(collection(db, BACKUP_COLLECTION));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const d of all.docs) {
    if (d.id < cutoffStr) {
      await deleteDoc(d.ref);
      console.log(`[Backup] Pruned old backup ${d.id}`);
    }
  }
}

export interface BackupSummary {
  date: string;
  createdAt: number;
  size: number;
  keys: string[];
}

export async function listBackups(): Promise<BackupSummary[]> {
  const all = await getDocs(collection(db, BACKUP_COLLECTION));
  const out: BackupSummary[] = [];
  all.forEach(d => {
    const data = d.data();
    const value = (data.value || {}) as Record<string, unknown>;
    out.push({
      date: d.id,
      createdAt: data.createdAt || 0,
      size: JSON.stringify(value).length,
      keys: Object.keys(value),
    });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getBackup(date: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, BACKUP_COLLECTION, date));
  return snap.exists() ? ((snap.data().value as Record<string, unknown>) ?? null) : null;
}

/**
 * Force-create a backup for today (overwrites existing one).
 * Use for manual snapshot before risky operations.
 */
export async function createManualBackup(): Promise<string> {
  const today = todayStr();
  const snapshot: Record<string, unknown> = {};
  for (const key of SYNC_KEYS) {
    const snap = await getDoc(doc(db, 'appData', key));
    if (snap.exists()) snapshot[key] = snap.data().value;
  }
  await setDoc(doc(db, BACKUP_COLLECTION, today), {
    value: snapshot,
    createdAt: Date.now(),
    manual: true,
  });
  return today;
}

/**
 * Restore a specific key from a backup snapshot.
 * mode='replace' → overwrite current Firestore data with backup value
 * mode='merge'   → deep-merge: current values win on collision, backup fills gaps (for recovering deleted records)
 */
export async function restoreKeyFromBackup(
  date: string,
  key: string,
  mode: 'replace' | 'merge'
): Promise<void> {
  const backup = await getBackup(date);
  if (!backup || !(key in backup)) {
    throw new Error(`Backup for ${date} does not contain key "${key}"`);
  }
  const backupValue = backup[key];

  if (mode === 'replace') {
    await setDoc(doc(db, 'appData', key), { value: backupValue, updatedAt: Date.now() });
    return;
  }

  const currentSnap = await getDoc(doc(db, 'appData', key));
  if (!currentSnap.exists()) {
    await setDoc(doc(db, 'appData', key), { value: backupValue, updatedAt: Date.now() });
    return;
  }
  const currentValue = currentSnap.data().value;
  const merged = mergeForRestore(currentValue, backupValue);
  await setDoc(doc(db, 'appData', key), { value: merged, updatedAt: Date.now() });
}

// Deep merge with CURRENT winning on collision; backup fills missing entries.
function mergeForRestore(current: unknown, backup: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(backup)) {
    const map = new Map<string, unknown>();
    for (const item of backup as Array<{ id?: string }>) {
      if (item?.id) map.set(item.id, item);
    }
    for (const item of current as Array<{ id?: string }>) {
      if (item?.id) map.set(item.id, item); // current overrides
    }
    return Array.from(map.values());
  }
  if (
    typeof current === 'object' &&
    current !== null &&
    !Array.isArray(current) &&
    typeof backup === 'object' &&
    backup !== null &&
    !Array.isArray(backup)
  ) {
    const result = { ...(backup as Record<string, unknown>) };
    for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
      if (k in result && typeof v === 'object' && v !== null && !Array.isArray(v)) {
        result[k] = mergeForRestore(v, result[k]);
      } else {
        result[k] = v; // current wins
      }
    }
    return result;
  }
  return current ?? backup;
}
