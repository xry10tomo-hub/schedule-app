'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, setDailyTasks, getTaskDefinitions, getMonthlySchedules, getShifts, generateId, exportToCSV, getMemberById, getTimelineForDate, setTimelineForDate, TASK_CATEGORIES, FIXED_TASK_NAMES, DEFAULT_TASKS } from '@/lib/store';
import type { DailyTask, TaskDefinition, ShiftEntry } from '@/lib/types';

// Timeline constants
const TIMELINE_START = 8; // 8:00
const TIMELINE_END = 22; // 22:00
const BLOCKS_PER_HOUR = 4; // 15-min blocks
const TOTAL_BLOCKS = (TIMELINE_END - TIMELINE_START) * BLOCKS_PER_HOUR; // 56

// Color palette for tasks
const TASK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  '#e11d48', '#84cc16', '#0ea5e9', '#d946ef', '#fbbf24',
  '#22c55e', '#a855f7', '#fb7185', '#2dd4bf', '#facc15',
  '#78716c', '#64748b', '#0d9488', '#db2777', '#ea580c',
  '#4f46e5', '#059669', '#dc2626', '#7c3aed', '#ca8a04',
];

function blockToTime(blockIndex: number): string {
  const totalMinutes = TIMELINE_START * 60 + blockIndex * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function isBlockInShift(blockIndex: number, shift: ShiftEntry | undefined): boolean {
  if (!shift) return false;
  const blockStart = TIMELINE_START * 60 + blockIndex * 15;
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  const shiftStart = sh * 60 + sm;
  const shiftEnd = eh * 60 + em;
  return blockStart >= shiftStart && blockStart < shiftEnd;
}

export default function DailyPage() {
  const { members, currentUserId, dataVersion, selectedDate, setSelectedDate } = useAppContext();
  const [tasks, setTasksState] = useState<DailyTask[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [taskDefs, setTaskDefsState] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [viewTab, setViewTab] = useState<'plan' | 'actual'>('plan');

  // Timeline state
  const [timelineData, setTimelineDataState] = useState<Record<string, Record<string, string>>>({});
  const [selectedPaintTask, setSelectedPaintTask] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove'>('add');

  // Form state
  const [formCategory, setFormCategory] = useState('');
  const [formTask, setFormTask] = useState('');
  const [formAssignee, setFormAssignee] = useState(currentUserId);
  const [formRequiredCount, setFormRequiredCount] = useState(1);
  const [formMinutesPerUnit, setFormMinutesPerUnit] = useState(0);
  const [formComment, setFormComment] = useState('');

  const tasksByCategory = TASK_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = taskDefs.filter(t => t.category === cat);
    return acc;
  }, {} as Record<string, TaskDefinition[]>);

  // Build unique task name list for color mapping
  const uniqueTaskNames = useMemo(() => {
    const names = new Set<string>();
    tasks.forEach(t => names.add(t.taskName));
    // Also add tasks from timeline
    Object.values(timelineData).forEach(memberBlocks => {
      Object.values(memberBlocks).forEach(taskName => names.add(taskName));
    });
    return Array.from(names).sort();
  }, [tasks, timelineData]);

  function getTaskColor(taskName: string): string {
    const idx = uniqueTaskNames.indexOf(taskName);
    return idx >= 0 ? TASK_COLORS[idx % TASK_COLORS.length] : '#9ca3af';
  }

  const syncMonthlyTasks = useCallback(() => {
    const monthlySchedules = getMonthlySchedules().filter(s => s.date === selectedDate);
    const existingDaily = getDailyTasks();
    const dailyForDate = existingDaily.filter(t => t.date === selectedDate);

    let added = false;
    const newTasks = [...existingDaily];

    const taskNamesToAdd: string[] = [];
    for (const ms of monthlySchedules) {
      if (ms.taskName === '固定業務') {
        taskNamesToAdd.push(...FIXED_TASK_NAMES);
      } else {
        taskNamesToAdd.push(ms.taskName);
      }
    }

    const uniqueNames = [...new Set(taskNamesToAdd)];

    for (const taskName of uniqueNames) {
      const alreadyExists = dailyForDate.some(t => t.taskName === taskName);
      if (!alreadyExists) {
        const def = DEFAULT_TASKS.find(d => d.name === taskName);
        newTasks.push({
          id: generateId(),
          date: selectedDate,
          taskName,
          assigneeId: '',
          plannedCount: 1,
          minutesPerUnit: def?.estimatedMinutesPerUnit || 0,
          plannedMinutes: def?.estimatedMinutesPerUnit || 0,
          plannedPoints: 0,
          actualCount: 0,
          actualPoints: 0,
          actualMinutes: 0,
          startTime: '09:00',
          endTime: '18:00',
          status: 'pending',
          comment: '月次予定から自動反映',
        });
        added = true;
      }
    }

    if (added) {
      setDailyTasks(newTasks);
    }
    return newTasks.filter(t => t.date === selectedDate);
  }, [selectedDate]);

  const loadTasks = useCallback(() => {
    setTaskDefsState(getTaskDefinitions());
    const tasksForDate = syncMonthlyTasks();
    setTasksState(tasksForDate);
    setTimelineDataState(getTimelineForDate(selectedDate));
  }, [syncMonthlyTasks, selectedDate, dataVersion]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Shifts for selected date
  const shiftsForDate = getShifts().filter(s => s.date === selectedDate);

  // Members with shifts (active on this date)
  const activeMembers = useMemo(() => {
    return members.filter(m => shiftsForDate.some(s => s.memberId === m.id));
  }, [members, shiftsForDate]);

  // ===== Timeline handlers =====
  function handleBlockMouseDown(memberId: string, blockIndex: number) {
    if (!selectedPaintTask) return;
    const memberBlocks = { ...(timelineData[memberId] || {}) };
    const key = String(blockIndex);
    if (memberBlocks[key] === selectedPaintTask) {
      delete memberBlocks[key];
      setDragMode('remove');
    } else {
      memberBlocks[key] = selectedPaintTask;
      setDragMode('add');
    }
    const newData = { ...timelineData, [memberId]: memberBlocks };
    setTimelineDataState(newData);
    setTimelineForDate(selectedDate, newData);
    setIsDragging(true);
  }

  function handleBlockMouseEnter(memberId: string, blockIndex: number) {
    if (!isDragging || !selectedPaintTask) return;
    const shift = shiftsForDate.find(s => s.memberId === memberId);
    if (!isBlockInShift(blockIndex, shift)) return;

    const memberBlocks = { ...(timelineData[memberId] || {}) };
    const key = String(blockIndex);
    if (dragMode === 'remove') {
      delete memberBlocks[key];
    } else {
      memberBlocks[key] = selectedPaintTask;
    }
    const newData = { ...timelineData, [memberId]: memberBlocks };
    setTimelineDataState(newData);
    setTimelineForDate(selectedDate, newData);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // ===== Per-member timeline summary =====
  const memberTimelineSummary = useMemo(() => {
    return activeMembers.map(m => {
      const memberBlocks = timelineData[m.id] || {};
      const blockCount = Object.keys(memberBlocks).length;
      const plannedMinutes = blockCount * 15;

      // Task breakdown
      const taskBreakdown: Record<string, number> = {};
      Object.values(memberBlocks).forEach(taskName => {
        taskBreakdown[taskName] = (taskBreakdown[taskName] || 0) + 15;
      });

      // Actual from daily tasks
      const memberTasks = tasks.filter(t => t.assigneeId === m.id);
      const actualMinutes = memberTasks.reduce((s, t) => s + t.actualMinutes, 0);
      const actualCount = memberTasks.reduce((s, t) => s + t.actualCount, 0);

      // Shift info
      const shift = shiftsForDate.find(s => s.memberId === m.id);
      const shiftMinutes = shift ? (() => {
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const [eh, em] = shift.endTime.split(':').map(Number);
        return (eh * 60 + em) - (sh * 60 + sm);
      })() : 0;

      return {
        member: m,
        plannedMinutes,
        actualMinutes,
        actualCount,
        shiftMinutes,
        taskBreakdown,
        remainingMinutes: shiftMinutes - plannedMinutes,
      };
    });
  }, [activeMembers, timelineData, tasks, shiftsForDate]);

  // ===== Form handlers =====
  function handleAddTask() {
    if (!formTask) return;
    const def = taskDefs.find(t => t.name === formTask);
    const mpu = formMinutesPerUnit || def?.estimatedMinutesPerUnit || 0;
    const newTask: DailyTask = {
      id: generateId(),
      date: selectedDate,
      taskName: formTask,
      assigneeId: formAssignee,
      plannedCount: formRequiredCount,
      minutesPerUnit: mpu,
      plannedMinutes: formRequiredCount * mpu,
      plannedPoints: 0,
      actualCount: 0,
      actualPoints: 0,
      actualMinutes: 0,
      startTime: '09:00',
      endTime: '18:00',
      status: 'pending',
      comment: formComment,
    };
    const all = [...getDailyTasks(), newTask];
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
    resetForm();
  }

  function resetForm() {
    setFormCategory('');
    setFormTask('');
    setFormAssignee(currentUserId);
    setFormRequiredCount(1);
    setFormMinutesPerUnit(0);
    setFormComment('');
    setShowForm(false);
  }

  function handleUpdateField(id: string, field: string, value: number | string) {
    const all = getDailyTasks().map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, [field]: value };
      if (field === 'plannedCount' || field === 'minutesPerUnit') {
        const count = field === 'plannedCount' ? (value as number) : t.plannedCount;
        const mpu = field === 'minutesPerUnit' ? (value as number) : (t.minutesPerUnit || 0);
        updated.plannedMinutes = count * mpu;
      }
      return updated;
    });
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
  }

  function handleDeleteTask(id: string) {
    const all = getDailyTasks().filter(t => t.id !== id);
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
  }

  function handleExportCSV() {
    const data = tasks.map(t => ({
      日付: t.date,
      業務名: t.taskName,
      担当者: getMemberById(t.assigneeId)?.name || '',
      必要件数: t.plannedCount,
      '1回あたり時間_分': t.minutesPerUnit || 0,
      必要時間_分: t.plannedMinutes,
      実績件数: t.actualCount,
      実績点数: t.actualPoints,
      実績時間_分: t.actualMinutes,
      ステータス: t.status === 'completed' ? '完了' : t.status === 'in_progress' ? '進行中' : '未着手',
      コメント: t.comment,
    }));
    exportToCSV(data, `daily_tasks_${selectedDate}.csv`);
  }

  function handleTaskSelect(taskName: string) {
    setFormTask(taskName);
    const def = taskDefs.find(t => t.name === taskName);
    if (def) setFormMinutesPerUnit(def.estimatedMinutesPerUnit);
  }

  function handleCategoryChange(cat: string) {
    setFormCategory(cat);
    setFormTask('');
  }

  const filteredFormTasks = formCategory ? (tasksByCategory[formCategory] || []) : taskDefs;

  // === Dashboard calculations ===
  const totalRequiredMinutes = tasks.reduce((s, t) => s + t.plannedMinutes, 0);
  const availableResourceMinutes = shiftsForDate.reduce((sum, s) => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    return sum + (eh * 60 + em - sh * 60 - sm);
  }, 0);
  const totalActualMinutes = tasks.reduce((s, t) => s + t.actualMinutes, 0);
  const resourceBalance = availableResourceMinutes - totalRequiredMinutes;

  // 画像査定: planned points from 【LINE】画像査定 only
  const imageAssessmentPlannedPoints = tasks
    .filter(t => t.taskName === '【LINE】画像査定')
    .reduce((s, t) => s + t.plannedCount, 0);

  // 実査定: 点数 from 【査定】計算書作成, 件数 from 【補助】郵送物開封
  const realAssessmentPoints = tasks
    .filter(t => t.taskName === '【査定】計算書作成')
    .reduce((s, t) => s + t.plannedCount, 0);
  const realAssessmentCount = tasks
    .filter(t => t.taskName === '【補助】郵送物開封')
    .reduce((s, t) => s + t.plannedCount, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6" onMouseUp={handleMouseUp}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">日次業務入力</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">+ タスク追加</button>
            <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
          </div>
        </div>

        {/* Dashboard cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-lg px-4 py-3 border border-green-200 shadow-sm">
            <span className="text-xs text-green-600">本日のリソース</span>
            <p className="text-lg font-bold text-green-700">{availableResourceMinutes}分 ({(availableResourceMinutes / 60).toFixed(1)}h)</p>
            <p className="text-[10px] text-gray-400">{shiftsForDate.length}名出勤</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-orange-200 shadow-sm">
            <span className="text-xs text-orange-600">必要時間合計</span>
            <p className="text-lg font-bold text-orange-700">{totalRequiredMinutes}分 ({(totalRequiredMinutes / 60).toFixed(1)}h)</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 shadow-sm">
            <span className="text-xs text-gray-500">リソース差分</span>
            <p className={`text-lg font-bold ${resourceBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {resourceBalance >= 0 ? '+' : ''}{resourceBalance}分
            </p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-blue-200 shadow-sm">
            <span className="text-xs text-blue-600">実績合計</span>
            <p className="text-lg font-bold text-blue-700">{totalActualMinutes}分 ({(totalActualMinutes / 60).toFixed(1)}h)</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-purple-200 shadow-sm">
            <span className="text-xs text-purple-600">画像査定（予定）</span>
            <p className="text-lg font-bold text-purple-700">{imageAssessmentPlannedPoints}点</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-rose-200 shadow-sm">
            <span className="text-xs text-rose-600">実査定</span>
            <p className="text-sm font-bold text-rose-700">点数: {realAssessmentPoints}点</p>
            <p className="text-sm font-bold text-rose-700">件数: {realAssessmentCount}件</p>
          </div>
        </div>

        {/* Per-member summary cards */}
        {memberTimelineSummary.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {memberTimelineSummary.map(ms => (
              <div key={ms.member.id} className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
                <p className="text-xs font-bold text-gray-700">{ms.member.name}</p>
                <div className="flex justify-between mt-1">
                  <div>
                    <p className="text-[10px] text-green-600">予定</p>
                    <p className="text-sm font-bold text-green-700">{ms.plannedMinutes}分</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-blue-600">実績</p>
                    <p className="text-sm font-bold text-blue-700">{ms.actualMinutes}分</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">残り</p>
                    <p className={`text-sm font-bold ${ms.remainingMinutes >= 0 ? 'text-gray-600' : 'text-red-600'}`}>
                      {ms.remainingMinutes}分
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">シフト: {ms.shiftMinutes}分</p>
              </div>
            ))}
          </div>
        )}

        {/* Auto-sync notice */}
        {tasks.some(t => t.comment === '月次予定から自動反映') && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700">
            月次カレンダーの予定が自動反映されています
          </div>
        )}

        {/* Add Task Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-md border border-green-200 p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4">新規タスク追加</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">カテゴリ</label>
                <select value={formCategory} onChange={e => handleCategoryChange(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">全カテゴリ</option>
                  {TASK_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">業務名</label>
                <select value={formTask} onChange={e => handleTaskSelect(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択してください</option>
                  {formCategory ? (
                    filteredFormTasks.map(t => <option key={t.id} value={t.name}>{t.name.replace(/^【[^】]+】/, '')}</option>)
                  ) : (
                    TASK_CATEGORIES.map(cat => {
                      const catTasks = tasksByCategory[cat] || [];
                      if (catTasks.length === 0) return null;
                      return (
                        <optgroup key={cat} label={cat}>
                          {catTasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </optgroup>
                      );
                    })
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">担当者</label>
                <select value={formAssignee} onChange={e => setFormAssignee(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">未割当</option>
                  <optgroup label="社員">
                    {members.filter(m => m.role === 'employee').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                  <optgroup label="アルバイト">
                    {members.filter(m => m.role === 'parttime').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">必要件数/点数/回数</label>
                <input type="number" value={formRequiredCount} onChange={e => setFormRequiredCount(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">1回あたりの時間（分）</label>
                <input type="number" value={formMinutesPerUnit} onChange={e => setFormMinutesPerUnit(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">必要時間（分）</label>
                <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-bold">
                  {formRequiredCount * formMinutesPerUnit}分
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button onClick={handleAddTask} disabled={!formTask} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">追加</button>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setViewTab('plan')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'plan' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >予定入力</button>
          <button
            onClick={() => setViewTab('actual')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'actual' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >実績入力・集計</button>
        </div>

        {/* Plan Tab */}
        {viewTab === 'plan' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-green-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">業務名</th>
                    <th className="px-4 py-3 font-semibold">必要件数/点数/回数</th>
                    <th className="px-4 py-3 font-semibold">1回あたりの時間(分)</th>
                    <th className="px-4 py-3 font-semibold">必要時間(分)</th>
                    <th className="px-4 py-3 font-semibold">担当者</th>
                    <th className="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">タスクがありません。「+ タスク追加」から追加してください。</td></tr>
                  ) : (
                    tasks.map(t => {
                      const isFromMonthly = t.comment === '月次予定から自動反映';
                      return (
                        <tr key={t.id} className={`border-b border-gray-50 hover:bg-green-50/30 ${isFromMonthly ? 'bg-blue-50/30' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(t.taskName) }} />
                              <span className="text-xs">{t.taskName}</span>
                              {isFromMonthly && <span className="text-[10px] text-blue-500">(月次)</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <input type="number" value={t.plannedCount} onChange={e => handleUpdateField(t.id, 'plannedCount', Number(e.target.value))} className="w-20 border rounded px-2 py-1 text-sm" min={0} />
                          </td>
                          <td className="px-4 py-3">
                            <input type="number" value={t.minutesPerUnit || 0} onChange={e => handleUpdateField(t.id, 'minutesPerUnit', Number(e.target.value))} className="w-20 border rounded px-2 py-1 text-sm" min={0} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-orange-700">{t.plannedMinutes}分</span>
                          </td>
                          <td className="px-4 py-3">
                            <select value={t.assigneeId} onChange={e => handleUpdateField(t.id, 'assigneeId', e.target.value)} className="border rounded px-2 py-1 text-sm w-24">
                              <option value="">未割当</option>
                              <optgroup label="社員">
                                {members.filter(m => m.role === 'employee').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </optgroup>
                              <optgroup label="アルバイト">
                                {members.filter(m => m.role === 'parttime').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </optgroup>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeleteTask(t.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {tasks.length > 0 && (
                    <tr className="bg-orange-50 font-bold">
                      <td className="px-4 py-3 text-gray-700">合計</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-orange-700">{totalRequiredMinutes}分 ({(totalRequiredMinutes / 60).toFixed(1)}h)</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actual Tab */}
        {viewTab === 'actual' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">業務名</th>
                      <th className="px-4 py-3 font-semibold">担当者</th>
                      <th className="px-4 py-3 font-semibold">予定</th>
                      <th className="px-4 py-3 font-semibold">実績件数</th>
                      <th className="px-4 py-3 font-semibold">実績点数</th>
                      <th className="px-4 py-3 font-semibold">実績時間(分)</th>
                      <th className="px-4 py-3 font-semibold">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">タスクがありません</td></tr>
                    ) : (
                      tasks.map(t => {
                        const member = members.find(m => m.id === t.assigneeId);
                        return (
                          <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                            <td className="px-4 py-3 font-medium text-gray-800 text-xs">{t.taskName}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs">{member?.name || <span className="text-gray-400">未割当</span>}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{t.plannedCount}回 / {t.plannedMinutes}分</td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualCount} onChange={e => handleUpdateField(t.id, 'actualCount', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualPoints} onChange={e => handleUpdateField(t.id, 'actualPoints', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualMinutes} onChange={e => handleUpdateField(t.id, 'actualMinutes', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <select value={t.status} onChange={e => handleUpdateField(t.id, 'status', e.target.value)}
                                className={`text-xs rounded-full px-2 py-1 font-medium border-0 ${
                                  t.status === 'completed' ? 'bg-green-100 text-green-700' :
                                  t.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                <option value="pending">未着手</option>
                                <option value="in_progress">進行中</option>
                                <option value="completed">完了</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {tasks.length > 0 && (
                      <tr className="bg-blue-50 font-bold">
                        <td className="px-4 py-3 text-gray-700">合計</td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-blue-700">{tasks.reduce((s, t) => s + t.actualCount, 0)}</td>
                        <td className="px-4 py-3 text-blue-700">{tasks.reduce((s, t) => s + t.actualPoints, 0)}</td>
                        <td className="px-4 py-3 text-blue-700">{totalActualMinutes}分</td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Per-person Timeline with 15-min clickable blocks */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-gray-600">個人別タイムライン（15分単位 / クリックで入力）</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">業務選択:</label>
              <select
                value={selectedPaintTask}
                onChange={e => setSelectedPaintTask(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-xs min-w-[200px]"
              >
                <option value="">-- 業務を選択 --</option>
                {TASK_CATEGORIES.map(cat => {
                  const catTasks = (tasksByCategory[cat] || []);
                  if (catTasks.length === 0) return null;
                  return (
                    <optgroup key={cat} label={cat}>
                      {catTasks.map(t => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {selectedPaintTask && (
                <span className="flex items-center gap-1 text-xs bg-gray-50 px-2 py-1 rounded">
                  <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getTaskColor(selectedPaintTask) }} />
                  {selectedPaintTask.replace(/^【[^】]+】/, '')}
                </span>
              )}
            </div>
          </div>

          {/* Task color legend */}
          {uniqueTaskNames.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-gray-100">
              {uniqueTaskNames.map(name => (
                <button
                  key={name}
                  onClick={() => setSelectedPaintTask(name)}
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${
                    selectedPaintTask === name ? 'border-gray-800 bg-gray-100 font-bold' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(name) }} />
                  {name.replace(/^【[^】]+】/, '')}
                </button>
              ))}
            </div>
          )}

          {activeMembers.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">この日にシフト登録されているメンバーがいません</p>
          ) : (
            <div className="overflow-x-auto select-none">
              {/* Hour headers */}
              <div className="flex items-center mb-1">
                <div className="w-20 flex-shrink-0" />
                <div className="flex flex-1">
                  {Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => (
                    <div key={i} className="text-[10px] text-gray-400 text-center" style={{ width: `${100 / (TIMELINE_END - TIMELINE_START)}%` }}>
                      {TIMELINE_START + i}:00
                    </div>
                  ))}
                </div>
                <div className="w-16 flex-shrink-0" />
              </div>

              {/* Member rows */}
              {activeMembers.map(m => {
                const shift = shiftsForDate.find(s => s.memberId === m.id);
                const memberBlocks = timelineData[m.id] || {};

                // Calculate total for this member
                const totalBlocks = Object.keys(memberBlocks).length;
                const totalMins = totalBlocks * 15;

                return (
                  <div key={m.id} className="flex items-center mb-1 group">
                    <div className="w-20 flex-shrink-0 text-xs font-medium text-gray-700 text-right pr-2 truncate" title={m.name}>
                      {m.name}
                    </div>
                    <div className="flex flex-1 h-7 bg-gray-50 rounded overflow-hidden border border-gray-100">
                      {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                        const inShift = isBlockInShift(i, shift);
                        const taskName = memberBlocks[String(i)];
                        const isHourStart = i % BLOCKS_PER_HOUR === 0;

                        return (
                          <div
                            key={i}
                            className={`h-full transition-colors ${
                              isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'
                            } ${inShift ? 'cursor-pointer hover:opacity-80' : 'opacity-30'}`}
                            style={{
                              width: `${100 / TOTAL_BLOCKS}%`,
                              backgroundColor: taskName ? getTaskColor(taskName) : (inShift ? '#f9fafb' : '#f3f4f6'),
                            }}
                            title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
                            onMouseDown={() => inShift && handleBlockMouseDown(m.id, i)}
                            onMouseEnter={() => handleBlockMouseEnter(m.id, i)}
                          />
                        );
                      })}
                    </div>
                    <div className="w-16 flex-shrink-0 text-[10px] text-gray-500 text-right pl-1">
                      {totalMins}分
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Per-member task breakdown */}
          {memberTimelineSummary.some(ms => Object.keys(ms.taskBreakdown).length > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <h4 className="text-xs font-semibold text-gray-500 mb-2">業務内訳（タイムライン）</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {memberTimelineSummary.filter(ms => Object.keys(ms.taskBreakdown).length > 0).map(ms => (
                  <div key={ms.member.id} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-bold text-gray-700 mb-1">{ms.member.name}（合計 {ms.plannedMinutes}分）</p>
                    <div className="space-y-1">
                      {Object.entries(ms.taskBreakdown).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => (
                        <div key={taskName} className="flex items-center gap-2 text-[10px]">
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                          <span className="flex-1 text-gray-600 truncate">{taskName.replace(/^【[^】]+】/, '')}</span>
                          <span className="font-bold text-gray-700">{mins}分</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
