'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppContext, getMembers, getCurrentUser, setCurrentUser, DEFAULT_MEMBERS, DEFAULT_TASKS, DEFAULT_TASK_RESOURCES, STORAGE_KEYS, SYNC_KEYS } from '@/lib/store';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import type { Member } from '@/lib/types';

export default function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUserId, setCurrentUserIdState] = useState('');
  const [members, setMembersState] = useState<Member[]>(DEFAULT_MEMBERS);
  const [dataVersion, setDataVersion] = useState(0);
  const [firestoreReady, setFirestoreReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCurrentUserIdState(getCurrentUser());
    setMembersState(getMembers());

    // Initialize Firestore: seed defaults if empty, then subscribe
    async function initFirestore() {
      try {
        // Seed default data if Firestore is empty
        const defaults: [string, unknown][] = [
          [STORAGE_KEYS.members, DEFAULT_MEMBERS],
          [STORAGE_KEYS.tasks, DEFAULT_TASKS],
          [STORAGE_KEYS.taskResources, DEFAULT_TASK_RESOURCES],
        ];
        for (const [key, defaultVal] of defaults) {
          const snap = await getDoc(doc(db, 'appData', key));
          if (!snap.exists()) {
            await setDoc(doc(db, 'appData', key), { value: defaultVal, updatedAt: Date.now() });
          }
        }

        // Also push any existing localStorage data that's not yet in Firestore
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

        setFirestoreReady(true);
      } catch (err) {
        console.error('Firestore init error:', err);
        // App still works with localStorage only
        setFirestoreReady(false);
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
          const data = snap.data().value;
          localStorage.setItem(key, JSON.stringify(data));
          // Update members state if it's the members key
          if (key === STORAGE_KEYS.members) {
            setMembersState(data);
          }
          // Bump version to trigger re-renders in pages
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

  const refreshMembers = useCallback(() => {
    setMembersState(getMembers());
  }, []);

  if (loading) {
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
    }}>
      {children}
    </AppContext.Provider>
  );
}
