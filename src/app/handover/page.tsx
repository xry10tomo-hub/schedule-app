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
  getDailyTasks,
  generateId,
  getMemberById,
  getToday,
  getFixedTasks,
  TASK_CATEGORIES,
  DEFAULT_TASKS,
} from '@/lib/store';
import type { HandoverRequest, TaskDefinition, MonthlySchedule } from '@/lib/types';

type TabKey = 'new-handover' | 'handover-list' | 'new-important' | 'important-list' | 'member-tasks';

export default function HandoverPage() {
  const { currentUserId, members, dataVersion } = useAppContext();
  const currentMember = members.find(m => m.id === currentUserId);

  const [items, setItemsState] = useState<HandoverRequest[]>([]);
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [tab, setTab] = useState<TabKey>('handover-list');

  // Shared form state (used by both 新規引き継ぎ and 新規重要案件)
  const [formTask, setFormTask] = useState('');
  const [formDate, setFormDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [formReason, setFormReason] = useState('');
  const [formDetail, setFormDetail] = useState('');
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formScheduledTime, setFormScheduledTime] = useState('');

  // Member tasks tab date
  const [memberTaskDate, setMemberTaskDate] = useState(getToday());

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

  // All active items (shared/approved), newest first
  const allItems = items
    .filter(i => i.status === 'shared' || i.status === 'approved')
    .sort((a, b) => b.createdAt - a.createdAt);

  // Separate by type (backward compat: no type = 'handover')
  const handoverItems = allItems.filter(i => !i.type || i.type === 'handover');
  const importantItems = allItems.filter(i => i.type === 'important');

  // Group by targetDate for display
  function groupByDate(list: HandoverRequest[]) {
    const map = new Map<string, HandoverRequest[]>();
    for (const item of list) {
      const dateItems = map.get(item.targetDate) || [];
      dateItems.push(item);
      map.set(item.targetDate, dateItems);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  const handoverByDate = useMemo(() => groupByDate(handoverItems), [handoverItems]);
  const importantByDate = useMemo(() => groupByDate(importantItems), [importantItems]);

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

  function resetForm() {
    setFormTask('');
    setFormReason('');
    setFormDetail('');
    setFormCustomerName('');
    setFormScheduledTime('');
  }

  function handleSubmit(type: 'handover' | 'important') {
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
      customerName: formCustomerName || undefined,
      scheduledTime: formScheduledTime || undefined,
      type,
    };
    const all = [...getHandovers(), newItem];
    setHandovers(all);
    setItemsState(all);
    applyToMonthly(newItem);
    resetForm();
    setTab(type === 'handover' ? 'handover-list' : 'important-list');
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  // Member tasks: non-fixed daily tasks for selected date, grouped by member
  const memberTaskRows = useMemo(() => {
    const fixedSet = new Set(getFixedTasks());
    const dailyTasks = getDailyTasks().filter(t => t.date === memberTaskDate && !fixedSet.has(t.taskName));
    const byMember = new Map<string, typeof dailyTasks>();
    for (const t of dailyTasks) {
      const arr = byMember.get(t.assigneeId) || [];
      arr.push(t);
      byMember.set(t.assigneeId, arr);
    }
    return byMember;
  }, [memberTaskDate, dataVersion]);

  // Shared form JSX (reused for both 引き継ぎ and 重要案件 tabs)
  const formLabel = tab === 'new-important' ? '重要案件' : '引き継ぎ';
  const formBorderColor = tab === 'new-important' ? 'border-red-200' : 'border-green-200';
  const formTitleColor = tab === 'new-important' ? 'text-red-700' : 'text-green-700';
  const formBtnColor = tab === 'new-important' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700';

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">共有BOX</h1>
            <p className="text-gray-500 text-sm mt-1">引き継ぎ・重要案件・メンバー業務をチームで共有します</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex flex-wrap border-b border-gray-200 gap-0">
          {([
            { key: 'new-handover', label: '新規引き継ぎ', color: 'green', count: null },
            { key: 'handover-list', label: '引き継ぎ一覧', color: 'blue', count: handoverItems.length },
            { key: 'new-important', label: '新規重要案件', color: 'red', count: null },
            { key: 'important-list', label: '重要案件一覧', color: 'orange', count: importantItems.length },
            { key: 'member-tasks', label: 'メンバー別タスク', color: 'purple', count: null },
          ] as { key: TabKey; label: string; color: string; count: number | null }[]).map(({ key, label, color, count }) => {
            const activeColors: Record<string, string> = {
              green: 'border-green-600 text-green-700',
              blue: 'border-blue-600 text-blue-700',
              red: 'border-red-600 text-red-700',
              orange: 'border-orange-500 text-orange-700',
              purple: 'border-purple-600 text-purple-700',
            };
            const badgeColors: Record<string, string> = {
              blue: 'bg-blue-100 text-blue-700',
              orange: 'bg-orange-100 text-orange-700',
            };
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  tab === key ? activeColors[color] : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
                {count !== null && count > 0 && (
                  <span className={`ml-1 text-[10px] rounded-full px-1.5 py-0.5 ${badgeColors[color] || 'bg-gray-100 text-gray-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* New Handover / New Important form (shared) */}
        {(tab === 'new-handover' || tab === 'new-important') && (
          <div className={`bg-white rounded-xl shadow-sm border ${formBorderColor} p-6 space-y-4`}>
            <h3 className={`text-sm font-bold ${formTitleColor}`}>新規{formLabel}</h3>
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
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">顧客名（任意）</label>
                <input
                  type="text"
                  value={formCustomerName}
                  onChange={e => setFormCustomerName(e.target.value)}
                  placeholder="例: 〇〇様"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">対応時間（任意）</label>
                <input
                  type="time"
                  value={formScheduledTime}
                  onChange={e => setFormScheduledTime(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  {tab === 'new-important' ? '案件概要・理由' : '引き継ぎ理由'}
                </label>
                <input
                  type="text"
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                  placeholder={tab === 'new-important' ? '例: 重要顧客・期限あり' : '例: 当日完了できず翌日に持ち越し'}
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
                onClick={() => handleSubmit(tab === 'new-important' ? 'important' : 'handover')}
                disabled={!formTask || !formDate}
                className={`px-6 py-2 ${formBtnColor} text-white text-sm font-semibold rounded-lg disabled:opacity-50`}
              >共有する</button>
            </div>
          </div>
        )}

        {/* 引き継ぎ一覧 */}
        {tab === 'handover-list' && (
          <ItemList
            itemsByDate={handoverByDate}
            emptyText="引き継ぎはありません。「新規引き継ぎ」から作成してください。"
            formatDate={formatDate}
            currentUserId={currentUserId}
            taskDefs={taskDefs}
            tasksByCategory={tasksByCategory}
            onReload={reload}
          />
        )}

        {/* 重要案件一覧 */}
        {tab === 'important-list' && (
          <ItemList
            itemsByDate={importantByDate}
            emptyText="重要案件はありません。「新規重要案件」から作成してください。"
            formatDate={formatDate}
            currentUserId={currentUserId}
            taskDefs={taskDefs}
            tasksByCategory={tasksByCategory}
            onReload={reload}
            isImportant
          />
        )}

        {/* メンバー別タスク */}
        {tab === 'member-tasks' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-gray-700">表示日:</label>
              <input
                type="date"
                value={memberTaskDate}
                onChange={e => setMemberTaskDate(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              />
              <span className="text-xs text-gray-500">固定業務以外のタスクを表示</span>
            </div>
            {memberTaskRows.size === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                {memberTaskDate} の非固定タスクはありません。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {members.map(m => {
                  const tasks = memberTaskRows.get(m.id) || [];
                  if (tasks.length === 0) return null;
                  return (
                    <div key={m.id} className="bg-white rounded-xl shadow-sm border border-purple-100 overflow-hidden">
                      <div className="bg-purple-50 border-b border-purple-100 px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-bold text-purple-800">{m.name}</span>
                        <span className="text-[10px] bg-purple-200 text-purple-800 rounded-full px-2 py-0.5">{tasks.length}件</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {tasks.map(t => (
                          <div key={t.id} className="px-4 py-2.5">
                            <div className="flex justify-between items-start">
                              <span className="text-xs font-semibold text-gray-700 flex-1 mr-2">{t.taskName}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                t.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                t.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {t.status === 'completed' ? '完了' : t.status === 'in_progress' ? '進行中' : '予定'}
                              </span>
                            </div>
                            <div className="flex gap-3 mt-1 text-[10px] text-gray-500">
                              {t.startTime && <span>🕐 {t.startTime}〜{t.endTime}</span>}
                              <span>予定 {t.plannedCount}件 / {Math.round(t.plannedMinutes)}分</span>
                              {t.actualCount > 0 && <span className="text-emerald-600">実績 {t.actualCount}件</span>}
                            </div>
                            {t.comment && <p className="text-[10px] text-gray-500 mt-1 truncate">💬 {t.comment}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ===== Shared List Component =====
function ItemList({
  itemsByDate,
  emptyText,
  formatDate,
  currentUserId,
  taskDefs,
  tasksByCategory,
  onReload,
  isImportant = false,
}: {
  itemsByDate: [string, HandoverRequest[]][];
  emptyText: string;
  formatDate: (d: string) => string;
  currentUserId: string;
  taskDefs: TaskDefinition[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onReload: () => void;
  isImportant?: boolean;
}) {
  return (
    <div className="space-y-4">
      {itemsByDate.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
          {emptyText}
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
              onReload={onReload}
              isImportant={isImportant}
            />
          );
        })
      )}
    </div>
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
  isImportant = false,
}: {
  date: string;
  dateItems: HandoverRequest[];
  isPast: boolean;
  formatDate: (d: string) => string;
  currentUserId: string;
  taskDefs: TaskDefinition[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onReload: () => void;
  isImportant?: boolean;
}) {
  const [expanded, setExpanded] = useState(!isPast);
  const headerBg = isImportant
    ? (isPast ? 'bg-gray-100 border-b border-gray-200' : 'bg-red-50 border-b border-red-100')
    : (isPast ? 'bg-gray-100 border-b border-gray-200' : 'bg-blue-50 border-b border-blue-100');
  const headerText = isImportant
    ? (isPast ? 'text-gray-600' : 'text-red-700')
    : (isPast ? 'text-gray-600' : 'text-blue-700');
  const badgeClass = isImportant
    ? (isPast ? 'bg-gray-200 text-gray-600' : 'bg-red-100 text-red-700')
    : (isPast ? 'bg-gray-200 text-gray-600' : 'bg-blue-100 text-blue-700');

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isPast ? 'border-gray-200' : 'border-gray-100'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-5 py-3 flex items-center justify-between hover:bg-opacity-80 transition-colors ${headerBg}`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs ${expanded ? '' : 'rotate-[-90deg]'} transition-transform`}>▼</span>
          <h3 className={`text-sm font-bold ${headerText}`}>
            {isImportant ? '🔴' : '📅'} {formatDate(date)}（{date}）
          </h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeClass}`}>
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
              isImportant={isImportant}
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
  isImportant = false,
}: {
  item: HandoverRequest;
  currentUserId: string;
  taskDefs: TaskDefinition[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onReload: () => void;
  isImportant?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTask, setEditTask] = useState(item.taskName);
  const [editDate, setEditDate] = useState(item.targetDate);
  const [editReason, setEditReason] = useState(item.reason);
  const [editDetail, setEditDetail] = useState(item.detail);

  const applicant = getMemberById(item.applicantId);
  const isOwn = item.applicantId === currentUserId;
  const isCompleted = !!item.completed;

  // Suppress unused var (taskDefs reserved for future use)
  void taskDefs;

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
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">
              {isImportant ? '案件概要・理由' : '引き継ぎ理由'}
            </label>
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
          <button onClick={handleSave} className={`px-4 py-1 text-xs text-white rounded ${isImportant ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>保存</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`px-5 py-4 ${isCompleted ? 'bg-gray-50 opacity-60' : isOwn ? (isImportant ? 'bg-red-50/20' : 'bg-green-50/30') : ''}`}>
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
            ) : isImportant ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">🔴 重要</span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">共有済</span>
            )}
            <span className={`text-sm font-bold text-gray-800 ${isCompleted ? 'line-through' : ''}`}>{item.taskName}</span>
            <span className="text-xs text-gray-500">by {applicant?.name || item.applicantId}</span>
            {isOwn && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">自分</span>}
          </div>
          {(item.customerName || item.scheduledTime) && (
            <div className={`flex gap-3 text-xs mt-1 ${isCompleted ? 'line-through' : ''}`}>
              {item.customerName && (
                <span className="px-2 py-0.5 bg-pink-100 text-pink-800 rounded">👤 {item.customerName}</span>
              )}
              {item.scheduledTime && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">🕐 {item.scheduledTime}</span>
              )}
            </div>
          )}
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
