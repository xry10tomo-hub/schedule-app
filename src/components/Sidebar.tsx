'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/home', label: 'ホーム', icon: '📊' },
  { href: '/calendar', label: '月次カレンダー', icon: '📅' },
  { href: '/daily', label: '日次業務入力', icon: '📝' },
  { href: '/handover', label: '引き継ぎ', icon: '🔄' },
  { href: '/shipping', label: '郵送点数', icon: '📦' },
  { href: '/members', label: '業務及びメンバー管理', icon: '👥' },
  { href: '/shifts', label: 'シフト一覧', icon: '🕐' },
  { href: '/auto-assign', label: '自動割振', icon: '🤖' },
  { href: '/admin', label: '管理者ダッシュボード', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-3 left-3 z-50 md:hidden bg-green-700 text-white p-2 rounded-lg shadow-lg"
      >
        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {mobileOpen ? (
            <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
          ) : (
            <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>
          )}
        </svg>
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full z-40 bg-green-800 text-white flex flex-col
          transition-all duration-300 shadow-xl
          ${collapsed ? 'w-16' : 'w-60'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-green-700">
          {!collapsed && (
            <h1 className="text-lg font-bold tracking-wide">
              スケジュール管理
            </h1>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:block text-green-300 hover:text-white transition-colors"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {collapsed ? (
                <polyline points="9,18 15,12 9,6" />
              ) : (
                <polyline points="15,18 9,12 15,6" />
              )}
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-3 mx-2 rounded-lg mb-1 transition-all
                  ${isActive
                    ? 'bg-green-600 text-white shadow-md'
                    : 'text-green-200 hover:bg-green-700 hover:text-white'
                  }
                `}
              >
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-green-700">
          {!collapsed && (
            <p className="text-xs text-green-400">v1.0 Schedule Manager</p>
          )}
        </div>
      </aside>
    </>
  );
}
