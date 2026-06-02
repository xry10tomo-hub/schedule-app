'use client';

import { useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds (faster detection)
const IDLE_THRESHOLD_MS = 5_000;   // Consider user idle after 5s of no input (more aggressive)
const FORCE_RELOAD_DELAY_MS = 10_000; // After detecting new version, hard-reload within 10s no matter what

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
        // STRONG FORCE: 何があっても 10秒後に強制リロード（入力中でも実施）
        setTimeout(() => {
          if (!reloadingRef.current) {
            reloadingRef.current = true;
            window.location.reload();
          }
        }, FORCE_RELOAD_DELAY_MS);
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
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full text-center border-4 border-red-500">
        <div className="text-5xl mb-3">🔄</div>
        <h2 className="text-xl font-bold text-red-700 mb-2">新しいバージョンが公開されました</h2>
        <p className="text-sm text-gray-700 mb-4">
          他メンバーとの実績データを正しく共有するため、<br />
          <strong>今すぐ画面を更新してください</strong>。
        </p>
        <p className="text-xs text-gray-500 mb-4">
          10秒以内に自動で更新されます。<br />
          下のボタンを押せばすぐに更新できます。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-red-600 hover:bg-red-700 text-white font-bold px-8 py-3 rounded-lg text-base w-full"
        >
          今すぐ更新する
        </button>
      </div>
    </div>
  );
}
