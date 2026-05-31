'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getMonthlySchedules, setMonthlySchedules, getTaskDefinitions, setTaskDefinitions, generateId, getDaysInMonth, TASK_CATEGORIES, DEFAULT_TASKS, getFixedTasks, setFixedTasks, getFixedTaskDefaults, setFixedTaskDefaults } from '@/lib/store';
import type { FixedTaskDefault } from '@/lib/store';
import type { MonthlySchedule, TaskDefinition } from '@/lib/types';

// === OL 担当割当（週ごと・Mon-Friに表示） ===
// keyは月曜の日付 (YYYY-MM-DD)。
// 全7週のペアはすべてユニーク（同じ組合せ無し）+ 各人ほぼ2週間に1度のペース。
// 担当週数: 和田=3 / 潮田=2 / 国兼=3 / 熊谷=3 / 鈴木=3 (社員5名で計14スロット)
const OL_ASSIGNMENTS: Record<string, string[]> = {
  '2026-05-18': ['熊谷', '鈴木'],
  '2026-05-25': ['潮田', '国兼'],
  '2026-06-01': ['熊谷', '和田'],
  '2026-06-08': ['国兼', '鈴木'],
  '2026-06-15': ['潮田', '和田'],
  '2026-06-22': ['熊谷', '国兼'],
  '2026-06-29': ['鈴木', '和田'],
};

function getMondayOfWeek(year: number, month: number, day: number): string {
  const d = new Date(year, month, day);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ...
  const shift = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + shift);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function getOLForDay(year: number, month: number, day: number, dayOfWeek: number): string[] {
  // Mon-Fri (1-5) のみ表示。土日は表示しない。
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];
  const mondayKey = getMondayOfWeek(year, month, day);
  return OL_ASSIGNMENTS[mondayKey] || [];
}

export default function CalendarPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [schedules, setSchedulesState] = useState<MonthlySchedule[]>([]);
  const [taskDefs, setTaskDefsState] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [copiedDay, setCopiedDay] = useState<number | null>(null);

  const { dataVersion } = useAppContext();
  const loadSchedules = useCallback(() => {
    setSchedulesState(getMonthlySchedules());
    setTaskDefsState(getTaskDefinitions());
  }, [dataVersion]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const filteredSchedules = schedules.filter(s => s.date.startsWith(monthStr));

  function getSchedulesForDay(day: number) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    return filteredSchedules.filter(s => s.date === dateStr);
  }

  function handleAddSchedule(day: number, taskName: string) {
    if (!taskName) return;
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;

    const existing = getMonthlySchedules();
    const existingForDate = existing.filter(s => s.date === dateStr);

    // Prevent duplicate (same taskName on same date)
    if (existingForDate.some(s => s.taskName === taskName)) {
      loadSchedules();
      return;
    }

    const newSchedule: MonthlySchedule = {
      id: generateId(),
      memberId: '',
      date: dateStr,
      taskName, // '固定業務' is stored as-is
      plannedHours: 1,
    };
    setMonthlySchedules([...existing, newSchedule]);
    loadSchedules();
  }

  // 期間指定で一括追加（プルダウン・直接入力 両対応）
  function handleAddScheduleRange(startDay: number, endDay: number, taskName: string) {
    if (!taskName) return;
    const minDay = Math.min(startDay, endDay);
    const maxDay = Math.min(daysInMonth, Math.max(startDay, endDay));
    const existing = getMonthlySchedules();
    const newSchedules = [...existing];
    let addedCount = 0;
    for (let d = minDay; d <= maxDay; d++) {
      const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      if (newSchedules.some(s => s.date === dateStr && s.taskName === taskName)) continue;
      newSchedules.push({
        id: generateId(),
        memberId: '',
        date: dateStr,
        taskName,
        plannedHours: 1,
      });
      addedCount++;
    }
    if (addedCount > 0) {
      setMonthlySchedules(newSchedules);
      loadSchedules();
    }
  }

  function handleRemoveSchedule(id: string) {
    const updated = getMonthlySchedules().filter(s => s.id !== id);
    setMonthlySchedules(updated);
    loadSchedules();
  }

  function handleCopyDay(day: number) {
    setCopiedDay(day);
  }

  function handlePasteDay(targetDay: number) {
    if (copiedDay === null) return;
    const srcDateStr = `${monthStr}-${String(copiedDay).padStart(2, '0')}`;
    const tgtDateStr = `${monthStr}-${String(targetDay).padStart(2, '0')}`;
    const existing = getMonthlySchedules();
    const srcSchedules = existing.filter(s => s.date === srcDateStr);
    const tgtExisting = existing.filter(s => s.date === tgtDateStr);

    const newSchedules = [...existing];
    for (const src of srcSchedules) {
      if (!tgtExisting.some(t => t.taskName === src.taskName)) {
        newSchedules.push({
          id: generateId(),
          memberId: '',
          date: tgtDateStr,
          taskName: src.taskName,
          plannedHours: src.plannedHours,
        });
      }
    }
    setMonthlySchedules(newSchedules);
    loadSchedules();
    setCopiedDay(null);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  // Task options grouped by category, with 固定業務 at top
  const tasksByCategory = TASK_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = taskDefs.filter(t => t.category === cat);
    return acc;
  }, {} as Record<string, TaskDefinition[]>);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">月次カレンダー</h1>
          {copiedDay !== null && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-sm text-blue-700 flex items-center gap-2">
              {copiedDay}日のスケジュールをコピー中
              <button onClick={() => setCopiedDay(null)} className="text-blue-500 hover:text-blue-700 text-xs ml-2">取消</button>
            </div>
          )}
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-center gap-6">
          <button onClick={prevMonth} className="p-2 hover:bg-green-100 rounded-lg transition-colors">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
          </button>
          <h2 className="text-xl font-bold text-gray-800">{year}年 {month + 1}月</h2>
          <button onClick={nextMonth} className="p-2 hover:bg-green-100 rounded-lg transition-colors">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6"/></svg>
          </button>
        </div>

        {/* Calendar Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="grid grid-cols-7 border-b">
            {dayNames.map((d, i) => (
              <div key={d} className={`py-2 text-center text-xs font-semibold ${
                i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'
              }`}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOfWeek }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-[100px] border-b border-r border-gray-50 bg-gray-50/50" />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dayOfWeek = (firstDayOfWeek + i) % 7;
              const daySchedules = getSchedulesForDay(day);
              const isToday = new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;

              const olMembers = getOLForDay(year, month, day, dayOfWeek);
              return (
                <DayCell
                  key={day}
                  day={day}
                  daysInMonth={daysInMonth}
                  dayOfWeek={dayOfWeek}
                  isToday={isToday}
                  schedules={daySchedules}
                  tasksByCategory={tasksByCategory}
                  olMembers={olMembers}
                  onAdd={(taskName) => handleAddSchedule(day, taskName)}
                  onAddRange={(taskName, endDay) => handleAddScheduleRange(day, endDay, taskName)}
                  onRemove={handleRemoveSchedule}
                  onCopy={() => handleCopyDay(day)}
                  onPaste={copiedDay !== null ? () => handlePasteDay(day) : undefined}
                  onReloadTasks={loadSchedules}
                  isCopied={copiedDay === day}
                />
              );
            })}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function DayCell({
  day, daysInMonth, dayOfWeek, isToday, schedules, tasksByCategory, olMembers, onAdd, onAddRange, onRemove, onCopy, onPaste, isCopied, onReloadTasks
}: {
  day: number;
  daysInMonth: number;
  dayOfWeek: number;
  isToday: boolean;
  schedules: MonthlySchedule[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  olMembers: string[];
  onAdd: (taskName: string) => void;
  onAddRange: (taskName: string, endDay: number) => void;
  onRemove: (id: string) => void;
  onCopy: () => void;
  onPaste?: () => void;
  isCopied: boolean;
  onReloadTasks?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [formTask, setFormTask] = useState('');
  const [formEndDay, setFormEndDay] = useState<number>(day);
  const [expandedChipId, setExpandedChipId] = useState<string | null>(null);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<string>(TASK_CATEGORIES[0]);
  const [deleteTaskName, setDeleteTaskName] = useState('');
  // Fixed task management state (inline in monthly calendar)
  const [showFixedManager, setShowFixedManager] = useState(false);
  const [fixedTasksList, setFixedTasksList] = useState<string[]>([]);
  const [fixedDefaults, setFixedDefaults] = useState<Record<string, FixedTaskDefault>>({});
  const [addFixedSearch, setAddFixedSearch] = useState('');

  // Load fixed tasks when manager is opened
  useEffect(() => {
    if (showFixedManager) {
      setFixedTasksList(getFixedTasks());
      setFixedDefaults(getFixedTaskDefaults());
    }
  }, [showFixedManager]);

  function persistFixedTasks(next: string[]) {
    setFixedTasksList(next);
    setFixedTasks(next);
  }
  function persistFixedDefaults(next: Record<string, FixedTaskDefault>) {
    setFixedDefaults(next);
    setFixedTaskDefaults(next);
  }
  function handleToggleFixed(taskName: string) {
    const isOn = fixedTasksList.includes(taskName);
    const next = isOn ? fixedTasksList.filter(n => n !== taskName) : [...fixedTasksList, taskName];
    persistFixedTasks(next);
    if (!isOn && !fixedDefaults[taskName]) {
      // initialize default for newly added
      const allTasks = Array.from(new Set([...Object.values(tasksByCategory).flat().map(t => t.name)]));
      const def = allTasks.includes(taskName) ? Object.values(tasksByCategory).flat().find(t => t.name === taskName) : undefined;
      persistFixedDefaults({ ...fixedDefaults, [taskName]: { plannedCount: 1, minutesPerUnit: def?.estimatedMinutesPerUnit || 0 } });
    }
  }
  function handleUpdateFixedDefault(taskName: string, field: keyof FixedTaskDefault, value: number) {
    const existing = fixedDefaults[taskName] || { plannedCount: 1, minutesPerUnit: 0 };
    persistFixedDefaults({ ...fixedDefaults, [taskName]: { ...existing, [field]: value } });
  }

  function handleSubmit() {
    if (formEndDay !== day) {
      onAddRange(formTask, formEndDay);
    } else {
      onAdd(formTask);
    }
    setFormTask('');
    setFormEndDay(day);
    setShowForm(false);
  }

  return (
    <div className={`min-h-[100px] border-b border-r border-gray-50 p-1 relative group ${
      isToday ? 'bg-green-50' : isCopied ? 'bg-blue-50' : ''
    }`}>
      <div className="flex justify-between items-start">
        <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
          isToday ? 'bg-green-600 text-white' :
          dayOfWeek === 0 ? 'text-red-500' :
          dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-700'
        }`}>{day}</span>
        {olMembers.length > 0 && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 border border-cyan-300"
            title={`今週のOL担当: ${olMembers.join('・')}`}
          >🔄 OL: {olMembers.join('・')}</span>
        )}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
          {schedules.length > 0 && (
            <button onClick={onCopy} className="text-blue-500 hover:bg-blue-100 rounded p-0.5" title="コピー">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><path d="M9 1H2a1 1 0 00-1 1v7"/></svg>
            </button>
          )}
          {onPaste && (
            <button onClick={onPaste} className="text-green-500 hover:bg-green-100 rounded p-0.5" title="貼り付け">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 2H2v8h8V8"/><path d="M6 6l6-6M8 0h4v4"/></svg>
            </button>
          )}
          <button onClick={() => setShowForm(!showForm)} className="text-green-600 hover:bg-green-100 rounded p-0.5">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="7" y1="3" x2="7" y2="11"/><line x1="3" y1="7" x2="11" y2="7"/></svg>
          </button>
        </div>
      </div>

      {/* Schedule chips */}
      <div className="mt-1 space-y-0.5">
        {(showAll ? schedules : schedules.slice(0, 4)).map(s => {
          // Collect all known task names from master to detect 'イベント' (direct input)
          const knownNames = new Set<string>(['固定業務']);
          Object.values(tasksByCategory).forEach(list => list.forEach(t => knownNames.add(t.name)));
          const isEvent = !knownNames.has(s.taskName);
          const isExpanded = expandedChipId === s.id;
          const displayName = s.taskName === '固定業務' ? '★固定業務' : s.taskName.replace(/^【[^】]+】/, '');
          return (
            <div
              key={s.id}
              onClick={() => setExpandedChipId(isExpanded ? null : s.id)}
              className={`flex items-center gap-1 text-xs rounded px-1 py-0.5 group/chip cursor-pointer ${
                isExpanded ? 'relative z-20 shadow-lg ring-2 ring-blue-400' : ''
              } ${
                s.taskName === '固定業務'
                  ? 'bg-yellow-100 text-yellow-800 font-bold'
                  : isEvent
                    ? 'bg-pink-100 text-pink-800 font-bold border-2 border-pink-400'
                    : 'bg-green-100 text-green-800'
              }`}
              title={s.taskName}
            >
              {isEvent && <span className="text-[9px] flex-shrink-0">🎯</span>}
              <span className={isExpanded ? 'whitespace-normal break-all font-bold' : 'truncate'}>{displayName}</span>
              <button
                onClick={e => { e.stopPropagation(); onRemove(s.id); }}
                className={`${isExpanded ? 'opacity-100' : 'opacity-0 group-hover/chip:opacity-100'} text-red-400 hover:text-red-600 flex-shrink-0`}
              >×</button>
            </div>
          );
        })}
        {schedules.length > 4 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-blue-500 hover:text-blue-700 hover:underline w-full text-left"
          >
            {showAll ? '▲ 閉じる' : `▼ +${schedules.length - 4} more`}
          </button>
        )}
      </div>

      {/* Add form dropdown - flips upward for days in last rows to avoid being clipped */}
      {showForm && (
        <div className={`absolute z-50 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-72 space-y-2 ${
          day >= 22 ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}>
          <p className="text-[10px] font-semibold text-gray-500">プルダウンから選択</p>
          <select value={formTask} onChange={e => setFormTask(e.target.value)} className="w-full text-xs border rounded px-2 py-1.5">
            <option value="">業務名を選択</option>
            <option value="固定業務" className="font-bold">★ 固定業務（一括追加）</option>
            {Object.entries(tasksByCategory).map(([cat, tasks]) => {
              if (tasks.length === 0) return null;
              return (
                <optgroup key={cat} label={cat}>
                  {tasks.map(t => <option key={t.id} value={t.name}>{t.name.replace(/^【[^】]+】/, '')}</option>)}
                </optgroup>
              );
            })}
          </select>
          <p className="text-[10px] font-semibold text-gray-500 pt-1 border-t border-gray-100">または直接入力</p>
          <input
            type="text"
            value={formTask}
            onChange={e => setFormTask(e.target.value)}
            placeholder="業務名を入力（例: 【販売】特別案件）"
            className="w-full text-xs border rounded px-2 py-1.5"
            onKeyDown={e => { if (e.key === 'Enter' && formTask) handleSubmit(); }}
          />
          {/* 期間指定（同月内） */}
          <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 space-y-1">
            <p className="text-[10px] font-semibold text-blue-700">📅 期間指定で一括登録（同月内）</p>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-600">{day}日</span>
              <span className="text-gray-400">〜</span>
              <input
                type="number"
                min={day}
                max={daysInMonth}
                value={formEndDay}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setFormEndDay(Math.max(day, Math.min(daysInMonth, v)));
                }}
                className="w-14 border rounded px-1 py-0.5 text-xs text-center"
              />
              <span className="text-gray-600">日</span>
              <button
                onClick={() => setFormEndDay(daysInMonth)}
                className="ml-1 text-[10px] text-blue-600 hover:underline"
                title="月末まで"
              >月末</button>
              <button
                onClick={() => setFormEndDay(day)}
                className="text-[10px] text-gray-500 hover:underline"
                title="当日のみ"
              >当日のみ</button>
            </div>
            {formEndDay !== day && (
              <p className="text-[10px] text-blue-700">→ {day}日 〜 {formEndDay}日 の <strong>{formEndDay - day + 1}日間</strong>に同じ業務を一括追加</p>
            )}
          </div>
          <div className="flex gap-1">
            <button onClick={handleSubmit} disabled={!formTask} className="flex-1 bg-green-600 text-white text-xs rounded px-2 py-1 disabled:opacity-50">追加</button>
            <button onClick={() => setShowForm(false)} className="flex-1 bg-gray-200 text-gray-600 text-xs rounded px-2 py-1">閉じる</button>
          </div>

          {/* Task master management */}
          <div className="border-t border-gray-100 pt-2 mt-2">
            <button
              onClick={e => { e.stopPropagation(); setShowTaskManager(v => !v); }}
              className="w-full text-[10px] text-blue-600 hover:underline"
            >{showTaskManager ? '▲ 業務マスター管理を閉じる' : '⚙️ 業務マスター管理（追加・削除）'}</button>
            {showTaskManager && (
              <div className="mt-2 space-y-2">
                {/* Add to master */}
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-600">新規業務をマスターに追加</p>
                  <input
                    type="text"
                    value={newTaskName}
                    onChange={e => setNewTaskName(e.target.value)}
                    placeholder="業務名（例: 【販売】特別案件）"
                    className="w-full text-[10px] border rounded px-2 py-1"
                  />
                  <select
                    value={newTaskCategory}
                    onChange={e => setNewTaskCategory(e.target.value)}
                    className="w-full text-[10px] border rounded px-2 py-1"
                  >
                    {TASK_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <button
                    onClick={() => {
                      if (!newTaskName.trim()) return;
                      const allTasks = getTaskDefinitions();
                      if (allTasks.some(t => t.name === newTaskName.trim())) {
                        alert('同名の業務が既に存在します');
                        return;
                      }
                      const newTask = {
                        id: generateId(),
                        name: newTaskName.trim(),
                        category: newTaskCategory,
                        defaultPointsPerUnit: 1,
                        estimatedMinutesPerUnit: 10,
                      };
                      setTaskDefinitions([...allTasks, newTask]);
                      setNewTaskName('');
                      onReloadTasks?.();
                    }}
                    disabled={!newTaskName.trim()}
                    className="w-full bg-blue-600 text-white text-[10px] rounded py-1 disabled:opacity-50"
                  >+ 業務をマスターに追加</button>
                </div>

                {/* Delete from master */}
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-gray-600">既存業務をマスターから削除</p>
                  <select
                    value={deleteTaskName}
                    onChange={e => setDeleteTaskName(e.target.value)}
                    className="w-full text-[10px] border rounded px-2 py-1"
                  >
                    <option value="">削除する業務を選択</option>
                    {Object.entries(tasksByCategory).map(([cat, list]) => {
                      if (list.length === 0) return null;
                      return (
                        <optgroup key={cat} label={cat}>
                          {list.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                  <button
                    onClick={() => {
                      if (!deleteTaskName) return;
                      if (!confirm(`「${deleteTaskName}」をマスターから削除しますか？`)) return;
                      const allTasks = getTaskDefinitions();
                      setTaskDefinitions(allTasks.filter(t => t.name !== deleteTaskName));
                      setDeleteTaskName('');
                      onReloadTasks?.();
                    }}
                    disabled={!deleteTaskName}
                    className="w-full bg-red-600 text-white text-[10px] rounded py-1 disabled:opacity-50"
                  >🗑️ 選択した業務を削除</button>
                </div>
              </div>
            )}
          </div>

          {/* ===== Fixed Tasks Management (固定業務マスター編集) ===== */}
          <div className="border-t border-amber-100 pt-2 mt-2">
            <button
              onClick={e => { e.stopPropagation(); setShowFixedManager(v => !v); }}
              className="w-full text-[10px] text-amber-700 hover:underline font-semibold"
            >{showFixedManager ? '▲ ★固定業務マスター管理を閉じる' : '★ 固定業務マスター管理（追加・削除・件数編集）'}</button>
            {showFixedManager && (
              <div className="mt-2 space-y-2 bg-amber-50/50 p-2 rounded">
                <p className="text-[10px] text-amber-800">
                  ここで設定した固定業務は、「★固定業務」を選択した日に自動展開されます。件数・1回あたり時間は毎日同じ値で適用されます。
                </p>

                {/* Current fixed tasks list */}
                <div>
                  <p className="text-[10px] font-bold text-gray-600 mb-1">現在の固定業務 ({fixedTasksList.length}件)</p>
                  {fixedTasksList.length === 0 ? (
                    <p className="text-[10px] text-gray-400">未設定</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {fixedTasksList.map(name => {
                        const d = fixedDefaults[name] || { plannedCount: 1, minutesPerUnit: 0 };
                        return (
                          <div key={name} className="flex items-center gap-1 bg-white rounded px-1 py-1 border border-amber-200">
                            <span className="flex-1 text-[10px] text-amber-900 truncate" title={name}>{name}</span>
                            <input
                              type="number" min={0} value={d.plannedCount}
                              onChange={e => handleUpdateFixedDefault(name, 'plannedCount', Number(e.target.value))}
                              className="w-10 border rounded px-1 py-0.5 text-[9px] text-right"
                              title="必要件数"
                            />
                            <span className="text-[8px] text-gray-400">×</span>
                            <input
                              type="number" min={0} value={d.minutesPerUnit}
                              onChange={e => handleUpdateFixedDefault(name, 'minutesPerUnit', Number(e.target.value))}
                              className="w-10 border rounded px-1 py-0.5 text-[9px] text-right"
                              title="1回あたり分"
                            />
                            <span className="text-[8px] text-gray-400">分</span>
                            <button
                              onClick={() => handleToggleFixed(name)}
                              className="text-red-400 hover:text-red-600 text-[10px] px-0.5"
                              title="固定業務から外す"
                            >×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Add to fixed tasks */}
                <div className="border-t border-amber-200 pt-2">
                  <p className="text-[10px] font-bold text-gray-600 mb-1">固定業務を追加</p>
                  <input
                    type="text"
                    placeholder="業務名で検索..."
                    value={addFixedSearch}
                    onChange={e => setAddFixedSearch(e.target.value)}
                    className="w-full text-[10px] border rounded px-2 py-1 mb-1"
                  />
                  <div className="max-h-32 overflow-y-auto border border-amber-200 rounded bg-white">
                    {(() => {
                      const q = addFixedSearch.toLowerCase();
                      const candidates = Object.values(tasksByCategory).flat().filter(t =>
                        !fixedTasksList.includes(t.name) &&
                        (!q || t.name.toLowerCase().includes(q))
                      );
                      if (candidates.length === 0) {
                        return <p className="text-[10px] text-gray-400 text-center py-2">追加可能な業務がありません</p>;
                      }
                      return candidates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => handleToggleFixed(t.name)}
                          className="w-full text-left px-2 py-1 text-[10px] hover:bg-amber-100 border-b border-amber-50"
                        >+ {t.name}</button>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
