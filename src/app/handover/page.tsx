'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import {
  useAppContext,
  getHandovers,
  setHandovers,
  getTaskDefinitions,
  getMonthlySchedules,
  setMonthlySchedules,
  generateId,
  getMemberById,
  getToday,
  TASK_CATEGORIES,
  DEFAULT_TASKS,
} from '@/lib/store';
import type { HandoverRequest, TaskDefinition, MonthlySchedule } from '@/lib/types';

type TabKey = 'share' | 'list';

export default function HandoverPage() {
  const { currentUserId, members, dataVersion } = useAppContext();
  const currentMember = members.find(m => m.id === currentUserId);

  const [items, setItemsState] = useState<HandoverRequest[]>([]);
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [tab, setTab] = useState<TabKey>('list');

  // Form state
  const [formTask, setFormTask] = useState('');
  const [formDate, setFormDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [formReason, setFormReason] = useState('');
  const [formDetail, setFormDetail] = useState('');

  const reload = useCallback(() => {
    setItemsState(getHandovers());
    setTaskDefs(getTaskDefinitions());
  }, []);

  useEffect(() => { reload(); }, [reload, dataVersion]);

  const tasksByCategory = useMemo(() => {
    return TASK_CATEGORIES.reduce((acc, cat) => {
      acc[cat] = taskDefs.filter(t => t.category === cat);
      return acc;
    }, {} as Record<string, TaskDefinition[]>);
  }, [taskDefs]);

  // All shared items, newest first
  const allItems = items
    .filter(i => i.status === 'shared' || i.status === 'approved')
    .sort((a, b) => b.createdAt - a.createdAt);

  // Group by target date for display
  const itemsByDate = useMemo(() => {
    const map = new Map<string, HandoverRequest[]>();
    for (const item of allItems) {
      const dateItems = map.get(item.targetDate) || [];
      dateItems.push(item);
      map.set(item.targetDate, dateItems);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allItems]);

  function applyToMonthly(item: HandoverRequest) {
    const existing = getMonthlySchedules();
    const dup = existing.find(s => s.date === item.targetDate && s.taskName === item.taskName);
    if (dup) return;
    const ms: MonthlySchedule = {
      id: generateId(),
      memberId: item.applicantId,
      date: item.targetDate,
      taskName: item.taskName,
      plannedHours: 1,
    };
    setMonthlySchedules([...existing, ms]);
  }

  function handleSubmit() {
    if (!currentUserId) {
      alert('ログインしてください');
      return;
    }
    if (!formTask || !formDate) {
      alert('業務と対象日を入力してください');
      return;
    }
    const newItem: HandoverRequest = {
      id: generateId(),
      applicantId: currentUserId,
      targetDate: formDate,
      taskName: formTask,
      reason: formReason,
      detail: formDetail,
      status: 'shared',
      reviewerId: '',
      reviewComment: '',
      createdAt: Date.now(),
      reviewedAt: 0,
    };
    const all = [...getHandovers(), newItem];
    setHandovers(all);
    setItemsState(all);
    // Auto-apply to monthly calendar
    applyToMonthly(newItem);
    setFormTask('');
    setFormReason('');
    setFormDetail('');
    setTab('list');
  }

  function handleDelete(id: string) {
    if (!confirm('この共有を削除しますか？')) return;
    const all = getHandovers().filter(i => i.id !== id);
    setHandovers(all);
    setItemsState(all);
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">引き継ぎ共有BOX</h1>
            <p className="text-gray-500 text-sm mt-1">翌日以降への業務引き継ぎをチーム全員で共有します</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('share')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'share' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >新規共有</button>
          <button
            onClick={() => setTab('list')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'list' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >共有一覧 {allItems.length > 0 && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{allItems.length}</span>}</button>
        </div>

        {/* Share Tab (form) */}
        {tab === 'share' && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-green-700">新規引き継ぎ共有</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">対象日 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={formDate}
                  min={getToday()}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">共有者</label>
                <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
                  {currentMember?.name || '未ログイン'}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">業務名 <span className="text-red-500">*</span></label>
                <select
                  value={formTask}
                  onChange={e => setFormTask(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">選択してください</option>
                  {TASK_CATEGORIES.map(cat => {
                    const catTasks = tasksByCategory[cat] || [];
                    if (catTasks.length === 0) return null;
                    return (
                      <optgroup key={cat} label={cat}>
                        {catTasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">引き継ぎ理由</label>
                <input
                  type="text"
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                  placeholder="例: 当日完了できず翌日に持ち越し"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">詳細・申し送り内容</label>
                <textarea
                  value={formDetail}
                  onChange={e => setFormDetail(e.target.value)}
                  placeholder="進捗状況・残作業・注意点などを記載"
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-y"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSubmit}
                disabled={!formTask || !formDate}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >共有する</button>
            </div>
          </div>
        )}

        {/* List Tab - All shared items grouped by date */}
        {tab === 'list' && (
          <div className="space-y-4">
            {allItems.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                共有された引き継ぎはありません。「新規共有」から作成してください。
              </div>
            ) : (
              itemsByDate.map(([date, dateItems]) => (
                <div key={date} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3 bg-blue-50 border-b border-blue-100">
                    <h3 className="text-sm font-bold text-blue-700">📅 {formatDate(date)}（{date}）</h3>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {dateItems.map(item => {
                      const applicant = getMemberById(item.applicantId);
                      const isOwn = item.applicantId === currentUserId;
                      return (
                        <div key={item.id} className={`px-5 py-4 ${isOwn ? 'bg-green-50/30' : ''}`}>
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">共有済</span>
                                <span className="text-sm font-bold text-gray-800">{item.taskName}</span>
                                <span className="text-xs text-gray-500">by {applicant?.name || item.applicantId}</span>
                                {isOwn && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">自分</span>}
                              </div>
                              {item.reason && (
                                <p className="text-xs text-gray-600">💬 理由: {item.reason}</p>
                              )}
                              {item.detail && (
                                <p className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2 mt-1">📝 {item.detail}</p>
                              )}
                              <p className="text-[10px] text-gray-400">
                                共有日時: {new Date(item.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            {isOwn && (
                              <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">削除</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
