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

type TabKey = 'apply' | 'mine' | 'review';

function statusLabel(s: HandoverRequest['status']) {
  if (s === 'approved') return '承認済';
  if (s === 'rejected') return '却下';
  return '申請中';
}

function statusBadgeClass(s: HandoverRequest['status']) {
  if (s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

export default function HandoverPage() {
  const { currentUserId, members, dataVersion } = useAppContext();
  const currentMember = members.find(m => m.id === currentUserId);
  const isAdmin = !!currentMember?.isAdmin;

  const [items, setItemsState] = useState<HandoverRequest[]>([]);
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [tab, setTab] = useState<TabKey>(isAdmin ? 'review' : 'apply');

  // Form state
  const [formTask, setFormTask] = useState('');
  const [formDate, setFormDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [formReason, setFormReason] = useState('');
  const [formDetail, setFormDetail] = useState('');

  // Review state
  const [reviewComment, setReviewComment] = useState<Record<string, string>>({});

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

  const myItems = items
    .filter(i => i.applicantId === currentUserId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const pendingItems = items
    .filter(i => i.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);

  const reviewedItems = items
    .filter(i => i.status !== 'pending')
    .sort((a, b) => b.reviewedAt - a.reviewedAt);

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
      status: 'pending',
      reviewerId: '',
      reviewComment: '',
      createdAt: Date.now(),
      reviewedAt: 0,
    };
    const all = [...getHandovers(), newItem];
    setHandovers(all);
    setItemsState(all);
    setFormTask('');
    setFormReason('');
    setFormDetail('');
    setTab('mine');
  }

  function applyToMonthly(item: HandoverRequest) {
    // Add to monthly schedule for the targetDate (skip if duplicate)
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

  function handleDecision(id: string, decision: 'approved' | 'rejected') {
    const all = getHandovers();
    const idx = all.findIndex(i => i.id === id);
    if (idx < 0) return;
    const updated: HandoverRequest = {
      ...all[idx],
      status: decision,
      reviewerId: currentUserId,
      reviewComment: reviewComment[id] || '',
      reviewedAt: Date.now(),
    };
    all[idx] = updated;
    setHandovers(all);
    setItemsState(all);
    if (decision === 'approved') {
      applyToMonthly(updated);
    }
  }

  function handleDelete(id: string) {
    if (!confirm('この申請を削除しますか？')) return;
    const all = getHandovers().filter(i => i.id !== id);
    setHandovers(all);
    setItemsState(all);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">引き継ぎ</h1>
            <p className="text-gray-500 text-sm mt-1">翌日以降への業務引き継ぎを管理者に申請します</p>
          </div>
          {isAdmin && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
              管理者: {currentMember?.name}
            </span>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('apply')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'apply' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >新規申請</button>
          <button
            onClick={() => setTab('mine')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'mine' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >自分の申請 {myItems.length > 0 && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{myItems.length}</span>}</button>
          {isAdmin && (
            <button
              onClick={() => setTab('review')}
              className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
                tab === 'review' ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >審査 {pendingItems.length > 0 && <span className="ml-1 text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5">{pendingItems.length}</span>}</button>
          )}
        </div>

        {/* Apply Tab */}
        {tab === 'apply' && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 p-6 space-y-4">
            <h3 className="text-sm font-bold text-green-700">新規引き継ぎ申請</h3>
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
                <label className="block text-xs font-semibold text-gray-600 mb-1">申請者</label>
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
              >申請する</button>
            </div>
          </div>
        )}

        {/* My applications tab */}
        {tab === 'mine' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-blue-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">対象日</th>
                    <th className="px-4 py-3 font-semibold">業務名</th>
                    <th className="px-4 py-3 font-semibold">理由</th>
                    <th className="px-4 py-3 font-semibold">詳細</th>
                    <th className="px-4 py-3 font-semibold">ステータス</th>
                    <th className="px-4 py-3 font-semibold">審査者</th>
                    <th className="px-4 py-3 font-semibold">審査コメント</th>
                    <th className="px-4 py-3 font-semibold">申請日時</th>
                    <th className="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {myItems.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">申請がありません。「新規申請」から作成してください。</td></tr>
                  ) : (
                    myItems.map(item => {
                      const reviewer = getMemberById(item.reviewerId);
                      return (
                        <tr key={item.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                          <td className="px-4 py-3 font-medium text-gray-800">{item.targetDate}</td>
                          <td className="px-4 py-3 text-xs">{item.taskName}</td>
                          <td className="px-4 py-3 text-xs text-gray-600">{item.reason || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate" title={item.detail}>{item.detail || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadgeClass(item.status)}`}>
                              {statusLabel(item.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">{reviewer?.name || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate" title={item.reviewComment}>{item.reviewComment || '-'}</td>
                          <td className="px-4 py-3 text-[10px] text-gray-500">
                            {new Date(item.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-4 py-3">
                            {item.status === 'pending' && (
                              <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600 text-xs">取下げ</button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Review tab (admin only) */}
        {tab === 'review' && isAdmin && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-5">
              <h3 className="text-sm font-bold text-amber-700 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 bg-amber-500 rounded-full" />
                審査待ち（{pendingItems.length}件）
              </h3>
              {pendingItems.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">審査待ちの申請はありません</p>
              ) : (
                <div className="space-y-3">
                  {pendingItems.map(item => {
                    const applicant = getMemberById(item.applicantId);
                    return (
                      <div key={item.id} className="border border-amber-100 rounded-lg p-4 bg-amber-50/30">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                          <div>
                            <p className="text-[10px] text-gray-500">申請者</p>
                            <p className="text-sm font-bold">{applicant?.name || item.applicantId}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-gray-500">対象日</p>
                            <p className="text-sm font-bold">{item.targetDate}</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-[10px] text-gray-500">業務名</p>
                            <p className="text-sm font-bold">{item.taskName}</p>
                          </div>
                          {item.reason && (
                            <div className="md:col-span-4">
                              <p className="text-[10px] text-gray-500">理由</p>
                              <p className="text-xs text-gray-700">{item.reason}</p>
                            </div>
                          )}
                          {item.detail && (
                            <div className="md:col-span-4">
                              <p className="text-[10px] text-gray-500">詳細・申し送り</p>
                              <p className="text-xs text-gray-700 whitespace-pre-wrap">{item.detail}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                          <input
                            type="text"
                            value={reviewComment[item.id] || ''}
                            onChange={e => setReviewComment({ ...reviewComment, [item.id]: e.target.value })}
                            placeholder="審査コメント（任意）"
                            className="flex-1 border rounded-lg px-3 py-2 text-xs"
                          />
                          <button
                            onClick={() => handleDecision(item.id, 'approved')}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg"
                          >許可</button>
                          <button
                            onClick={() => handleDecision(item.id, 'rejected')}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg"
                          >却下</button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2">
                          申請日時: {new Date(item.createdAt).toLocaleString('ja-JP')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700">審査済み履歴</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">対象日</th>
                      <th className="px-4 py-3 font-semibold">申請者</th>
                      <th className="px-4 py-3 font-semibold">業務名</th>
                      <th className="px-4 py-3 font-semibold">ステータス</th>
                      <th className="px-4 py-3 font-semibold">審査コメント</th>
                      <th className="px-4 py-3 font-semibold">審査日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewedItems.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-xs">履歴はありません</td></tr>
                    ) : (
                      reviewedItems.map(item => {
                        const applicant = getMemberById(item.applicantId);
                        return (
                          <tr key={item.id} className="border-b border-gray-50">
                            <td className="px-4 py-2 text-xs">{item.targetDate}</td>
                            <td className="px-4 py-2 text-xs">{applicant?.name || item.applicantId}</td>
                            <td className="px-4 py-2 text-xs">{item.taskName}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadgeClass(item.status)}`}>
                                {statusLabel(item.status)}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-gray-600 max-w-xs truncate" title={item.reviewComment}>{item.reviewComment || '-'}</td>
                            <td className="px-4 py-2 text-[10px] text-gray-500">
                              {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
