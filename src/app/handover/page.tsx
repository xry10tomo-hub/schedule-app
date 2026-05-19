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
  getMemberTasks,
  setMemberTasks,
  generateId,
  getMemberById,
  getToday,
  TASK_CATEGORIES,
  DEFAULT_TASKS,
} from '@/lib/store';
import type { HandoverRequest, TaskDefinition, MonthlySchedule, MemberTask, MemberTaskPriority, MemberTaskStatus } from '@/lib/types';

type TabKey = 'new-handover' | 'handover-list' | 'new-important' | 'important-list' | 'member-tasks';

export default function HandoverPage() {
  const { currentUserId, members, dataVersion } = useAppContext();
  const currentMember = members.find(m => m.id === currentUserId);

  const [items, setItemsState] = useState<HandoverRequest[]>([]);
  const [memberTaskItems, setMemberTaskItems] = useState<MemberTask[]>([]);
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

  // Member tasks tab state
  const [showMemberTaskForm, setShowMemberTaskForm] = useState(false);
  const [mtFilterAssignee, setMtFilterAssignee] = useState('');
  const [mtFilterStatus, setMtFilterStatus] = useState<MemberTaskStatus | ''>('');
  // New member task form
  const [mtAssigneeId, setMtAssigneeId] = useState('');
  const [mtTaskContent, setMtTaskContent] = useState('');
  const [mtDetail, setMtDetail] = useState('');
  const [mtPlannedDate, setMtPlannedDate] = useState(getToday());
  const [mtPriority, setMtPriority] = useState<MemberTaskPriority>('medium');
  const [mtStatus, setMtStatus] = useState<MemberTaskStatus>('pending');
  const [mtNote, setMtNote] = useState('');

  const reload = useCallback(() => {
    setItemsState(getHandovers());
    setTaskDefs(getTaskDefinitions());
    setMemberTaskItems(getMemberTasks());
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

  // Member task helpers
  function handleMemberTaskSubmit() {
    if (!mtAssigneeId || !mtTaskContent || !mtPlannedDate) {
      alert('担当者・業務内容・完了日（予定）を入力してください');
      return;
    }
    const newTask: MemberTask = {
      id: generateId(),
      assigneeId: mtAssigneeId,
      creatorId: currentUserId,
      taskContent: mtTaskContent,
      detail: mtDetail,
      plannedCompletionDate: mtPlannedDate,
      priority: mtPriority,
      status: mtStatus,
      createdAt: Date.now(),
      note: mtNote || undefined,
    };
    const all = [...getMemberTasks(), newTask];
    setMemberTasks(all);
    setMemberTaskItems(all);
    // Reset form
    setMtAssigneeId('');
    setMtTaskContent('');
    setMtDetail('');
    setMtPlannedDate(getToday());
    setMtPriority('medium');
    setMtStatus('pending');
    setMtNote('');
    setShowMemberTaskForm(false);
  }

  // Filtered member tasks for display
  const filteredMemberTasks = useMemo(() => {
    let list = [...memberTaskItems];
    if (mtFilterAssignee) list = list.filter(t => t.assigneeId === mtFilterAssignee);
    if (mtFilterStatus) list = list.filter(t => t.status === mtFilterStatus);
    // Sort: priority (high→medium→low), then plannedCompletionDate asc
    const pOrder: Record<MemberTaskPriority, number> = { high: 0, medium: 1, low: 2 };
    list.sort((a, b) => {
      const pd = pOrder[a.priority] - pOrder[b.priority];
      if (pd !== 0) return pd;
      return a.plannedCompletionDate.localeCompare(b.plannedCompletionDate);
    });
    return list;
  }, [memberTaskItems, mtFilterAssignee, mtFilterStatus]);

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
        <div className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-xl">
          {([
            { key: 'new-handover',  label: '新規引き継ぎ',    icon: '✏️', activeClass: 'bg-teal-600 text-white shadow-md', hoverClass: 'hover:bg-teal-50 hover:text-teal-700', count: null },
            { key: 'handover-list', label: '引き継ぎ一覧',    icon: '📋', activeClass: 'bg-teal-600 text-white shadow-md', hoverClass: 'hover:bg-teal-50 hover:text-teal-700', count: handoverItems.length },
            { key: 'new-important', label: '新規重要案件',    icon: '🔴', activeClass: 'bg-red-600 text-white shadow-md',  hoverClass: 'hover:bg-red-50 hover:text-red-700',   count: null },
            { key: 'important-list',label: '重要案件一覧',    icon: '📌', activeClass: 'bg-red-600 text-white shadow-md',  hoverClass: 'hover:bg-red-50 hover:text-red-700',   count: importantItems.length },
            { key: 'member-tasks',  label: 'メンバー別タスク', icon: '👥', activeClass: 'bg-purple-600 text-white shadow-md', hoverClass: 'hover:bg-purple-50 hover:text-purple-700', count: filteredMemberTasks.length },
          ] as { key: TabKey; label: string; icon: string; activeClass: string; hoverClass: string; count: number | null }[]).map(({ key, label, icon, activeClass, hoverClass, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                tab === key ? activeClass : `text-gray-500 ${hoverClass}`
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {count !== null && count > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                  tab === key ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
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
            {/* Header: filter + add button */}
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={mtFilterAssignee}
                onChange={e => setMtFilterAssignee(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">全担当者</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select
                value={mtFilterStatus}
                onChange={e => setMtFilterStatus(e.target.value as MemberTaskStatus | '')}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">全ステータス</option>
                <option value="pending">未着手</option>
                <option value="in_progress">進行中</option>
                <option value="completed">完了</option>
              </select>
              <span className="text-xs text-gray-500 ml-auto">{filteredMemberTasks.length}件</span>
              <button
                onClick={() => setShowMemberTaskForm(v => !v)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors"
              >{showMemberTaskForm ? 'キャンセル' : '＋ 新規登録'}</button>
            </div>

            {/* New task form */}
            {showMemberTaskForm && (
              <div className="bg-white rounded-xl shadow-sm border border-purple-200 p-5 space-y-4">
                <h3 className="text-sm font-bold text-purple-700">新規タスク登録</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">担当者 <span className="text-red-500">*</span></label>
                    <select value={mtAssigneeId} onChange={e => setMtAssigneeId(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="">選択してください</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">完了日（予定）<span className="text-red-500">*</span></label>
                    <input type="date" value={mtPlannedDate} onChange={e => setMtPlannedDate(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">業務内容 <span className="text-red-500">*</span></label>
                    <input type="text" value={mtTaskContent} onChange={e => setMtTaskContent(e.target.value)}
                      placeholder="例: ○○顧客の見積書作成、リスト整理など"
                      className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">詳細・内容</label>
                    <textarea value={mtDetail} onChange={e => setMtDetail(e.target.value)}
                      placeholder="具体的な作業内容・手順・注意点など"
                      rows={3} className="w-full border rounded-lg px-3 py-2 text-sm resize-y" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">優先度</label>
                    <select value={mtPriority} onChange={e => setMtPriority(e.target.value as MemberTaskPriority)}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="high">🔴 高</option>
                      <option value="medium">🟡 中</option>
                      <option value="low">🟢 低</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">ステータス</label>
                    <select value={mtStatus} onChange={e => setMtStatus(e.target.value as MemberTaskStatus)}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      <option value="pending">未着手</option>
                      <option value="in_progress">進行中</option>
                      <option value="completed">完了</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">備考</label>
                    <input type="text" value={mtNote} onChange={e => setMtNote(e.target.value)}
                      placeholder="関連URL・補足情報など"
                      className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleMemberTaskSubmit}
                    disabled={!mtAssigneeId || !mtTaskContent || !mtPlannedDate}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                  >登録する</button>
                </div>
              </div>
            )}

            {/* Task list */}
            {filteredMemberTasks.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center text-gray-400">
                タスクがありません。「＋ 新規登録」から追加してください。
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMemberTasks.map(task => (
                  <MemberTaskRow
                    key={task.id}
                    task={task}
                    members={members}
                    currentUserId={currentUserId}
                    onReload={reload}
                  />
                ))}
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

// ===== MemberTask Row Component =====
const PRIORITY_LABEL: Record<MemberTaskPriority, string> = { high: '🔴 高', medium: '🟡 中', low: '🟢 低' };
const PRIORITY_CLASS: Record<MemberTaskPriority, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};
const STATUS_LABEL: Record<MemberTaskStatus, string> = { pending: '未着手', in_progress: '進行中', completed: '完了' };
const STATUS_CLASS: Record<MemberTaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

function MemberTaskRow({
  task,
  members,
  currentUserId,
  onReload,
}: {
  task: MemberTask;
  members: import('@/lib/types').Member[];
  currentUserId: string;
  onReload: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(task.taskContent);
  const [editDetail, setEditDetail] = useState(task.detail);
  const [editDate, setEditDate] = useState(task.plannedCompletionDate);
  const [editPriority, setEditPriority] = useState<MemberTaskPriority>(task.priority);
  const [editStatus, setEditStatus] = useState<MemberTaskStatus>(task.status);
  const [editNote, setEditNote] = useState(task.note || '');
  const [editAssigneeId, setEditAssigneeId] = useState(task.assigneeId);

  const assignee = members.find(m => m.id === task.assigneeId);
  const creator = members.find(m => m.id === task.creatorId);
  const isOwn = task.creatorId === currentUserId;
  const isCompleted = task.status === 'completed';
  const isOverdue = !isCompleted && task.plannedCompletionDate < getToday();

  function handleSave() {
    if (!editContent || !editDate || !editAssigneeId) {
      alert('担当者・業務内容・完了日を入力してください');
      return;
    }
    const all = getMemberTasks().map(t => t.id === task.id ? {
      ...t,
      assigneeId: editAssigneeId,
      taskContent: editContent,
      detail: editDetail,
      plannedCompletionDate: editDate,
      priority: editPriority,
      status: editStatus,
      note: editNote || undefined,
      completedAt: editStatus === 'completed' && t.status !== 'completed' ? Date.now() : t.completedAt,
    } : t);
    setMemberTasks(all);
    setIsEditing(false);
    onReload();
  }

  function handleDelete() {
    if (!confirm('このタスクを削除しますか？')) return;
    const all = getMemberTasks().filter(t => t.id !== task.id);
    setMemberTasks(all);
    onReload();
  }

  function handleStatusChange(newStatus: MemberTaskStatus) {
    const all = getMemberTasks().map(t => t.id === task.id ? {
      ...t,
      status: newStatus,
      completedAt: newStatus === 'completed' ? Date.now() : t.completedAt,
    } : t);
    setMemberTasks(all);
    onReload();
  }

  if (isEditing) {
    return (
      <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">担当者</label>
            <select value={editAssigneeId} onChange={e => setEditAssigneeId(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs">
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">完了日（予定）</label>
            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">業務内容</label>
            <input type="text" value={editContent} onChange={e => setEditContent(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">詳細</label>
            <textarea value={editDetail} onChange={e => setEditDetail(e.target.value)}
              rows={3} className="w-full border rounded px-2 py-1 text-xs resize-y" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">優先度</label>
            <select value={editPriority} onChange={e => setEditPriority(e.target.value as MemberTaskPriority)}
              className="w-full border rounded px-2 py-1 text-xs">
              <option value="high">🔴 高</option>
              <option value="medium">🟡 中</option>
              <option value="low">🟢 低</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">ステータス</label>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value as MemberTaskStatus)}
              className="w-full border rounded px-2 py-1 text-xs">
              <option value="pending">未着手</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-semibold text-gray-600 mb-1">備考</label>
            <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">キャンセル</button>
          <button onClick={handleSave} className="px-4 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded">保存</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${
      isCompleted ? 'border-gray-200 opacity-70' :
      isOverdue ? 'border-red-300' :
      task.priority === 'high' ? 'border-red-200' :
      'border-purple-100'
    }`}>
      <div className="px-4 py-3 flex flex-col sm:flex-row justify-between items-start gap-2">
        <div className="flex-1 space-y-1.5">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${PRIORITY_CLASS[task.priority]}`}>
              {PRIORITY_LABEL[task.priority]}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${STATUS_CLASS[task.status]}`}>
              {STATUS_LABEL[task.status]}
            </span>
            {isOverdue && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700">⚠️ 期限超過</span>
            )}
            <span className={`text-sm font-bold text-gray-800 ${isCompleted ? 'line-through text-gray-400' : ''}`}>
              {task.taskContent}
            </span>
          </div>
          {/* Meta row */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            <span className="font-semibold text-purple-700">👤 {assignee?.name || '不明'}</span>
            <span>📅 完了予定: <b className={isOverdue ? 'text-red-600' : ''}>{task.plannedCompletionDate}</b></span>
            <span className="text-gray-400">登録: {creator?.name || '不明'} / {new Date(task.createdAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</span>
            {task.completedAt && (
              <span className="text-emerald-600">✅ 完了: {new Date(task.completedAt).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</span>
            )}
          </div>
          {/* Detail */}
          {task.detail && (
            <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">📝 {task.detail}</p>
          )}
          {/* Note */}
          {task.note && (
            <p className="text-xs text-gray-500">💡 {task.note}</p>
          )}
          {/* Quick status buttons */}
          {!isCompleted && (
            <div className="flex gap-2 mt-1">
              {task.status !== 'in_progress' && (
                <button onClick={() => handleStatusChange('in_progress')}
                  className="text-[10px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200 transition-colors">
                  → 進行中にする
                </button>
              )}
              <button onClick={() => handleStatusChange('completed')}
                className="text-[10px] px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded border border-emerald-200 transition-colors">
                ✓ 完了にする
              </button>
            </div>
          )}
          {isCompleted && (
            <button onClick={() => handleStatusChange('pending')}
              className="text-[10px] px-2 py-0.5 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded border border-gray-200 transition-colors">
              ↩ 未着手に戻す
            </button>
          )}
        </div>
        {/* Edit/Delete (owner only) */}
        {isOwn && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => setIsEditing(true)} className="text-blue-400 hover:text-blue-600 text-xs">編集</button>
            <button onClick={handleDelete} className="text-red-400 hover:text-red-600 text-xs">削除</button>
          </div>
        )}
      </div>
    </div>
  );
}
