'use client';

import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
const IDLE_THRESHOLD_MS = 15_000; // Consider user idle after 15s of no input

export default function VersionChecker() {
  const initialVersionRef = useRef<string | null>(null);
  const lastUserActivityRef = useRef<number>(Date.now());
  const newerVersionPendingRef = useRef<boolean>(false);
  const reloadingRef = useRef<boolean>(false);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Track user activity (typing, clicking, scrolling)
    const handleActivity = () => {
      lastUserActivityRef.current = Date.now();
    };
    const events: (keyof DocumentEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => document.addEventListener(ev, handleActivity, { passive: true }));
    return () => {
      events.forEach(ev => document.removeEventListener(ev, handleActivity));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchVersion(): Promise<string | null> {
      try {
        const res = await fetch('/api/version', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json.version || null;
      } catch {
        return null;
      }
    }

    // Detect if user is currently editing/active
    function isUserBusy(): boolean {
      // Editing in input/textarea/select
      const active = document.activeElement;
      if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        (active as HTMLElement).isContentEditable
      )) {
        return true;
      }
      // Recently active (within idle threshold)
      const idleMs = Date.now() - lastUserActivityRef.current;
      if (idleMs < IDLE_THRESHOLD_MS) return true;
      return false;
    }

    function tryReload() {
      if (reloadingRef.current) return;
      if (!newerVersionPendingRef.current) return;
      if (isUserBusy()) return;
      reloadingRef.current = true;
      // Use replace instead of reload to avoid keeping old page in history
      window.location.reload();
    }

    async function checkVersion() {
      if (cancelled) return;
      const current = await fetchVersion();
      if (cancelled || !current) return;

      // First fetch: record baseline
      if (initialVersionRef.current === null) {
        initialVersionRef.current = current;
        return;
      }

      // Newer version detected
      if (current !== initialVersionRef.current && !newerVersionPendingRef.current) {
        newerVersionPendingRef.current = true;
        setShowBanner(true);
        // Try immediate reload if user is idle
        tryReload();
      }
    }

    // Initial check
    checkVersion();

    // Periodic check
    const intervalId = setInterval(checkVersion, CHECK_INTERVAL_MS);
    // Also try reloading periodically once newer version is pending
    const idleCheckId = setInterval(() => {
      if (newerVersionPendingRef.current) tryReload();
    }, 5_000);

    // Re-check when tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkVersion();
        // If newer version was already detected, try reload now (tab refocus is a good moment)
        tryReload();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearInterval(idleCheckId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[10000] max-w-sm bg-blue-600 text-white rounded-xl shadow-2xl p-3 flex items-center gap-3 animate-fade-in">
      <span className="text-xl">🔄</span>
      <div className="flex-1">
        <p className="text-xs font-bold">新バージョンを取得しました</p>
        <p className="text-[10px] text-blue-100">操作が止まると自動で更新されます</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="bg-white text-blue-700 text-xs font-bold px-3 py-1.5 rounded hover:bg-blue-50"
      >
        今すぐ更新
      </button>
    </div>
  );
}
