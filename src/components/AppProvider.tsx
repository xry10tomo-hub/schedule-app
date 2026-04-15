'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { AppContext, getMembers, getCurrentUser, setCurrentUser, getToday, DEFAULT_MEMBERS, DEFAULT_TASKS, DEFAULT_TASK_RESOURCES, STORAGE_KEYS, SYNC_KEYS, setFirestoreSyncReady } from '@/lib/store';
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

  useEffect(() => {
    setCurrentUserIdState(getCurrentUser());

    // Initialize Firestore: load remote data first, then enable writes
    async function initFirestore() {
      try {
        const timeoutPromise = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000));
        const firestorePromise = (async () => {
          // Step 1: Load Firestore data INTO localStorage (Firestore is the source of truth)
          for (const key of SYNC_KEYS) {
            const snap = await getDoc(doc(db, 'appData', key));
            if (snap.exists()) {
              // Firestore has data → write it to localStorage (overwrite local)
              const data = snap.data().value;
              localStorage.setItem(key, JSON.stringify(data));
              if (key === STORAGE_KEYS.members) {
                setMembersState(data as Member[]);
              }
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

          // Step 3: Push any localStorage-only data to Firestore (for non-default keys)
          for (const key of SYNC_KEYS) {
            const snap = await getDoc(doc(db, 'appData', key));
            if (!snap.exists()) {
              const localData = localStorage.getItem(key);
              if (localData) {
                await setDoc(doc(db, 'appData', key), {
                  value: JSON.parse(localData),
                  updatedAt: Date.now(),
                });
              }
            }
          }
          return 'done' as const;
        })();

        const result = await Promise.race([firestorePromise, timeoutPromise]);
        if (result === 'timeout') {
          console.warn('Firestore init timed out, continuing with localStorage');
          setFirestoreReady(false);
        } else {
          setFirestoreReady(true);
        }
      } catch (err) {
        console.error('Firestore init error:', err);
        setFirestoreReady(false);
      }

      // Now read members from localStorage (which now has Firestore data)
      const loadedMembers = getMembers();
      setMembersState(loadedMembers);

      // Enable Firestore writes now that we have loaded remote data
      setFirestoreSyncReady(true);
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
          const data = snap.data().value;
          localStorage.setItem(key, JSON.stringify(data));
          if (key === STORAGE_KEYS.members) {
            setMembersState(data as Member[]);
          }
          setDataVersion(v => v + 1);
        }
      })
    );

    return () => unsubs.forEach(u => u());
  }, [firestoreReady]);

  const handleSetCurrentUserId = useCallback((id: string) => {
    setCurrentUserIdState(id);
    setCurrentUser(id);
  }, []);

  const handleSetSelectedDate = useCallback((date: string) => {
    setSelectedDateState(date);
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
    }}>
      {children}
    </AppContext.Provider>
  );
}
