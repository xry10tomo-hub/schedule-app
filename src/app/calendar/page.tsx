'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getMonthlySchedules, setMonthlySchedules, getTaskDefinitions, generateId, getDaysInMonth, TASK_CATEGORIES, DEFAULT_TASKS } from '@/lib/store';
import type { MonthlySchedule, TaskDefinition } from '@/lib/types';

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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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

              return (
                <DayCell
                  key={day}
                  day={day}
                  dayOfWeek={dayOfWeek}
                  isToday={isToday}
                  schedules={daySchedules}
                  tasksByCategory={tasksByCategory}
                  onAdd={(taskName) => handleAddSchedule(day, taskName)}
                  onRemove={handleRemoveSchedule}
                  onCopy={() => handleCopyDay(day)}
                  onPaste={copiedDay !== null ? () => handlePasteDay(day) : undefined}
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
  day, dayOfWeek, isToday, schedules, tasksByCategory, onAdd, onRemove, onCopy, onPaste, isCopied
}: {
  day: number;
  dayOfWeek: number;
  isToday: boolean;
  schedules: MonthlySchedule[];
  tasksByCategory: Record<string, TaskDefinition[]>;
  onAdd: (taskName: string) => void;
  onRemove: (id: string) => void;
  onCopy: () => void;
  onPaste?: () => void;
  isCopied: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formTask, setFormTask] = useState('');

  function handleSubmit() {
    onAdd(formTask);
    setFormTask('');
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
        {schedules.slice(0, 4).map(s => (
          <div key={s.id} className={`flex items-center gap-1 text-xs rounded px-1 py-0.5 group/chip ${
            s.taskName === '固定業務' ? 'bg-yellow-100 text-yellow-800 font-bold' : 'bg-green-100 text-green-800'
          }`}>
            <span className="truncate">{s.taskName === '固定業務' ? '★固定業務' : s.taskName.replace(/^【[^】]+】/, '')}</span>
            <button onClick={() => onRemove(s.id)} className="opacity-0 group-hover/chip:opacity-100 text-red-400 hover:text-red-600 flex-shrink-0">×</button>
          </div>
        ))}
        {schedules.length > 4 && (
          <p className="text-xs text-gray-400">+{schedules.length - 4} more</p>
        )}
      </div>

      {/* Add form dropdown */}
      {showForm && (
        <div className="absolute z-20 top-full left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-56 space-y-2">
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
          <div className="flex gap-1">
            <button onClick={handleSubmit} disabled={!formTask} className="flex-1 bg-green-600 text-white text-xs rounded px-2 py-1 disabled:opacity-50">追加</button>
            <button onClick={() => setShowForm(false)} className="flex-1 bg-gray-200 text-gray-600 text-xs rounded px-2 py-1">閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}
