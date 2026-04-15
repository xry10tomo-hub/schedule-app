'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMembers, setCurrentUser } from '@/lib/store';
import type { Member } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [members, setMembersState] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMembersState(getMembers());
    setReady(true);
  }, []);

  const employees = members.filter(m => m.role === 'employee');
  const parttimers = members.filter(m => m.role === 'parttime');

  function handleLogin() {
    if (!selectedId) return;
    setCurrentUser(selectedId);
    router.push('/home');
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-800 via-green-700 to-green-600">
        <div className="text-white font-medium">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-800 via-green-700 to-green-600">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md animate-fade-in">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">スケジュール管理</h1>
          <p className="text-gray-500 mt-1 text-sm">業務スケジュール・タスク管理システム</p>
        </div>

        {/* User selection */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">ユーザーを選択</label>

            <div className="mb-3">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">社員</p>
              <div className="grid grid-cols-3 gap-2">
                {employees.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`
                      px-3 py-2 rounded-lg text-sm font-medium transition-all border-2
                      ${selectedId === m.id
                        ? 'border-green-500 bg-green-50 text-green-800 shadow-md'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:bg-green-50'
                      }
                    `}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">アルバイト</p>
              <div className="grid grid-cols-3 gap-2">
                {parttimers.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className={`
                      px-3 py-2 rounded-lg text-sm font-medium transition-all border-2
                      ${selectedId === m.id
                        ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-md'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50'
                      }
                    `}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={!selectedId}
            className={`
              w-full py-3 rounded-xl font-bold text-white text-lg transition-all
              ${selectedId
                ? 'bg-green-600 hover:bg-green-700 shadow-lg hover:shadow-xl cursor-pointer'
                : 'bg-gray-300 cursor-not-allowed'
              }
            `}
          >
            ログイン
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          ※ パスワード不要・全員が編集可能です
        </p>
      </div>
    </div>
  );
}
