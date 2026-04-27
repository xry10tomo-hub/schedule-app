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
    // Newest date first (descending)
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
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
              itemsByDate.map(([date, dateItems]) => {
                const isPast = date < getToday();
                return (
                <HandoverDateGroup
                  key={date}
                  date={date}
                  dateItems={dateItems}
                  isPast={isPast}
                  formatDate={formatDate}
                  currentUserId={currentUserId}
                  taskDefs={taskDefs}
                  tasksByCategory={tasksByCategory}
                  onReload={reload}
                />
                );
              })
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

// Date group with collapse toggle for past dates
function HandoverDateGroup({
  date,
  dateItems,
  isPast,
  formatDate,
  currentUserId,
  taskDefs,
  tasksByCategory,
  onReload,
}: {
  date: string;
  dateItems: HandoverRequest[];
  isPast: boolean;
  formatDate: (d: string) => string;
  currentUserId: string;
  taskDefs: TaskDefinition[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(!isPast); // today/future auto-expanded, past collapsed
  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isPast ? 'border-gray-200' : 'border-gray-100'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-5 py-3 flex items-center justify-between hover:bg-opacity-80 transition-colors ${
          isPast ? 'bg-gray-100 border-b border-gray-200' : 'bg-blue-50 border-b border-blue-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs ${expanded ? '' : 'rotate-[-90deg]'} transition-transform`}>▼</span>
          <h3 className={`text-sm font-bold ${isPast ? 'text-gray-600' : 'text-blue-700'}`}>
            📅 {formatDate(date)}（{date}）
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${isPast ? 'bg-gray-200 text-gray-600' : 'bg-blue-100 text-blue-700'}`}>
            {dateItems.length}件
          </span>
          {isPast && <span className="text-[10px] text-gray-400">過去</span>}
        </div>
      </button>
      {expanded && (
        <div className="divide-y divide-gray-50">
          {dateItems.map(item => (
            <HandoverItemRow
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              taskDefs={taskDefs}
              tasksByCategory={tasksByCategory}
              onReload={onReload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Row component with inline edit/delete/complete
function HandoverItemRow({
  item,
  currentUserId,
  taskDefs,
  tasksByCategory,
  onReload,
}: {
  item: HandoverRequest;
  currentUserId: string;
  taskDefs: TaskDefinition[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onReload: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTask, setEditTask] = useState(item.taskName);
  const [editDate, setEditDate] = useState(item.targetDate);
  const [editReason, setEditReason] = useState(item.reason);
  const [editDetail, setEditDetail] = useState(item.detail);

  const applicant = getMemberById(item.applicantId);
  const isOwn = item.applicantId === currentUserId;
  const isCompleted = !!item.completed;

  function handleSave() {
    if (!editTask || !editDate) {
      alert('業務と対象日を入力してください');
      return;
    }
    const all = getHandovers().map(h => h.id === item.id ? {
      ...h,
      taskName: editTask,
      targetDate: editDate,
      reason: editReason,
      detail: editDetail,
    } : h);
    setHandovers(all);
    setIsEditing(false);
    onReload();
  }

  function handleDelete() {
    if (!confirm('この共有を削除しますか？')) return;
    const all = getHandovers().filter(h => h.id !== item.id);
    setHandovers(all);
    onReload();
  }

  function handleToggleComplete() {
    const all = getHandovers().map(h => h.id === item.id ? {
      ...h,
      completed: !h.completed,
      completedAt: !h.completed ? Date.now() : 0,
      completedBy: !h.completed ? currentUserId : '',
    } : h);
    setHandovers(all);
    onReload();
  }

  // Suppress unused var (taskDefs reserved for future use)
  void taskDefs;

  if (isEditing) {
    return (
      <div className="px-5 py-4 bg-yellow-50/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">対象日</label>
            <input type="date" value={editDate} min={getToday()}
              onChange={e => setEditDate(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">業務名</label>
            <select value={editTask} onChange={e => setEditTask(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs">
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
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">理由</label>
            <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">詳細</label>
            <textarea value={editDetail} onChange={e => setEditDetail(e.target.value)}
              rows={3} className="w-full border rounded px-2 py-1 text-xs resize-y" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">キャンセル</button>
          <button onClick={handleSave} className="px-4 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded">保存</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`px-5 py-4 ${isCompleted ? 'bg-gray-50 opacity-60' : isOwn ? 'bg-green-50/30' : ''}`}>
      <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="checkbox"
              checked={isCompleted}
              onChange={handleToggleComplete}
              className="w-4 h-4 accent-green-600 cursor-pointer"
              title="完了チェック"
            />
            {isCompleted ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600">完了</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">共有済</span>
            )}
            <span className={`text-sm font-bold text-gray-800 ${isCompleted ? 'line-through' : ''}`}>{item.taskName}</span>
            <span className="text-xs text-gray-500">by {applicant?.name || item.applicantId}</span>
            {isOwn && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">自分</span>}
          </div>
          {item.reason && (
            <p className={`text-xs text-gray-600 ${isCompleted ? 'line-through' : ''}`}>💬 理由: {item.reason}</p>
          )}
          {item.detail && (
            <p className={`text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2 mt-1 ${isCompleted ? 'line-through' : ''}`}>📝 {item.detail}</p>
          )}
          <p className="text-[10px] text-gray-400">
            共有日時: {new Date(item.createdAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {isCompleted && item.completedAt ? ` / 完了: ${new Date(item.completedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        {isOwn && !isCompleted && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setIsEditing(true)} className="text-blue-400 hover:text-blue-600 text-xs">編集</button>
            <button onClick={handleDelete} className="text-red-400 hover:text-red-600 text-xs">削除</button>
          </div>
        )}
      </div>
    </div>
  );
}
