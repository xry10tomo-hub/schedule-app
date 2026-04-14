'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, getShippingRecords, getShifts, getTimelineForDate, getActualTimelineForDate, setActualTimelineForDate, getTaskDefinitions, calculateDailySummary, TASK_CATEGORIES, fmtNum } from '@/lib/store';
import type { DailyTask, ShippingRecord, ShiftEntry, TaskDefinition } from '@/lib/types';

function ProgressRing({ percent, size = 120, stroke = 10, color = '#16a34a' }: { percent: number; size?: number; stroke?: number; color?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-1000 ease-out"
      />
      <text x={size / 2} y={size / 2} textAnchor="middle" dy="0.35em"
        className="fill-gray-700 text-xl font-bold" transform={`rotate(90, ${size / 2}, ${size / 2})`}>
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

function StatCard({ title, value, sub, color = 'green' }: { title: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    green: 'from-green-500 to-green-600',
    blue: 'from-blue-500 to-blue-600',
    orange: 'from-orange-500 to-orange-600',
    purple: 'from-purple-500 to-purple-600',
  };
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-fade-in">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
      <p className={`text-3xl font-bold mt-1 bg-gradient-to-r ${colors[color] || colors.green} bg-clip-text text-transparent`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// Timeline constants
const TIMELINE_START = 8;
const TIMELINE_END = 22;
const BLOCKS_PER_HOUR = 4;
const TOTAL_BLOCKS = (TIMELINE_END - TIMELINE_START) * BLOCKS_PER_HOUR;

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

export default function HomePage() {
  const { currentUserId, members, dataVersion, selectedDate } = useAppContext();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [shippingRecords, setShippingRecordsState] = useState<ShippingRecord[]>([]);
  const [timelineData, setTimelineData] = useState<Record<string, Record<string, string>>>({});
  const [actualTimelineData, setActualTimelineData] = useState<Record<string, Record<string, string>>>({});
  const [selectedPaintTask, setSelectedPaintTask] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove'>('add');
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>([]);
  const currentMember = members.find(m => m.id === currentUserId);

  const tasksByCategory = useMemo(() => {
    return TASK_CATEGORIES.reduce((acc, cat) => {
      acc[cat] = taskDefs.filter(t => t.category === cat);
      return acc;
    }, {} as Record<string, TaskDefinition[]>);
  }, [taskDefs]);

  useEffect(() => {
    const allTasks = getDailyTasks().filter(t => t.date === selectedDate);
    setTasks(allTasks);
    setShippingRecordsState(getShippingRecords().filter(r => r.date === selectedDate));
    setTimelineData(getTimelineForDate(selectedDate));
    setActualTimelineData(getActualTimelineForDate(selectedDate));
    setTaskDefs(getTaskDefinitions());
  }, [selectedDate, dataVersion, currentUserId]);

  const summary = calculateDailySummary(selectedDate);

  const totalShippingRecords = shippingRecords.length;
  const totalShippingPoints = shippingRecords.reduce((s, r) => s + r.points, 0);

  // Shift data
  const shiftsForDate = getShifts().filter(s => s.date === selectedDate);
  const myShift = shiftsForDate.find(s => s.memberId === currentUserId);
  const myShiftMinutes = myShift ? (() => {
    const [sh, sm] = myShift.startTime.split(':').map(Number);
    const [eh, em] = myShift.endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  })() : 0;

  // My timeline breakdown (plan)
  const myBlocks = timelineData[currentUserId] || {};
  const myTimelineTasks: Record<string, number> = {};
  Object.values(myBlocks).forEach(tn => { myTimelineTasks[tn] = (myTimelineTasks[tn] || 0) + 15; });
  const myTimelineTotal = Object.keys(myBlocks).length * 15;

  // My actual timeline breakdown
  const myActualBlocks = actualTimelineData[currentUserId] || {};
  const myActualTimelineTasks: Record<string, number> = {};
  Object.values(myActualBlocks).forEach(tn => { myActualTimelineTasks[tn] = (myActualTimelineTasks[tn] || 0) + 15; });
  const myActualTimelineTotal = Object.keys(myActualBlocks).length * 15;

  // ===== Timeline-based progress (plan vs actual) =====
  // Count distinct task names that appear in my plan timeline,
  // and how many of them also appear in my actual timeline.
  const myPlannedTaskSet = new Set(Object.values(myBlocks));
  const myActualTaskSet = new Set(Object.values(myActualBlocks));
  const myPlannedTaskCount = myPlannedTaskSet.size;
  const myDoneTaskCount = Array.from(myPlannedTaskSet).filter(tn => myActualTaskSet.has(tn)).length;
  const myProgress = myPlannedTaskCount > 0 ? (myDoneTaskCount / myPlannedTaskCount) * 100 : 0;

  // Team-wide timeline progress
  const teamPlannedSet = new Set<string>();
  const teamDonePairs = new Set<string>(); // memberId|taskName done in actual
  Object.entries(timelineData).forEach(([memberId, blocks]) => {
    Object.values(blocks).forEach(tn => teamPlannedSet.add(`${memberId}|${tn}`));
  });
  Object.entries(actualTimelineData).forEach(([memberId, blocks]) => {
    Object.values(blocks).forEach(tn => {
      const key = `${memberId}|${tn}`;
      if (teamPlannedSet.has(key)) teamDonePairs.add(key);
    });
  });
  const teamPlannedCount = teamPlannedSet.size;
  const teamDoneCount = teamDonePairs.size;
  const teamProgress = teamPlannedCount > 0 ? (teamDoneCount / teamPlannedCount) * 100 : 0;

  // ===== Actual timeline paint handlers =====
  function handleActualBlockMouseDown(blockIndex: number) {
    if (!selectedPaintTask || !currentUserId) return;
    const memberBlocks = { ...(actualTimelineData[currentUserId] || {}) };
    const key = String(blockIndex);
    if (memberBlocks[key] === selectedPaintTask) {
      delete memberBlocks[key];
      setDragMode('remove');
    } else {
      memberBlocks[key] = selectedPaintTask;
      setDragMode('add');
    }
    const newData = { ...actualTimelineData, [currentUserId]: memberBlocks };
    setActualTimelineData(newData);
    setActualTimelineForDate(selectedDate, newData);
    setIsDragging(true);
  }

  function handleActualBlockMouseEnter(blockIndex: number) {
    if (!isDragging || !selectedPaintTask || !currentUserId) return;
    const inShift = myShift ? (() => {
      const [sh, sm] = myShift.startTime.split(':').map(Number);
      const [eh, em] = myShift.endTime.split(':').map(Number);
      const blockStart = TIMELINE_START * 60 + blockIndex * 15;
      return blockStart >= sh * 60 + sm && blockStart < eh * 60 + em;
    })() : false;
    if (!inShift) return;

    const memberBlocks = { ...(actualTimelineData[currentUserId] || {}) };
    const key = String(blockIndex);
    if (dragMode === 'remove') {
      delete memberBlocks[key];
    } else {
      memberBlocks[key] = selectedPaintTask;
    }
    const newData = { ...actualTimelineData, [currentUserId]: memberBlocks };
    setActualTimelineData(newData);
    setActualTimelineForDate(selectedDate, newData);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // ===== Browser notification for overdue tasks =====
  const notifiedBlocksRef = useRef<Set<string>>(new Set());
  const [overdueAlerts, setOverdueAlerts] = useState<{ blockIndex: number; taskName: string; scheduledTime: string }[]>([]);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const checkOverdue = useCallback(() => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (selectedDate !== todayStr) {
      setOverdueAlerts([]);
      return;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const planned = timelineData[currentUserId] || {};
    const actual = actualTimelineData[currentUserId] || {};
    const alerts: { blockIndex: number; taskName: string; scheduledTime: string }[] = [];

    for (const [blockStr, taskName] of Object.entries(planned)) {
      const blockIndex = Number(blockStr);
      const blockEndMinutes = TIMELINE_START * 60 + (blockIndex + 1) * 15;
      // 15 minutes after the block's end time
      if (currentMinutes >= blockEndMinutes + 30 && !actual[blockStr]) {
        const scheduledTime = blockToTime(blockIndex);
        alerts.push({ blockIndex, taskName, scheduledTime });

        // Send browser notification (once per block)
        const notifKey = `${selectedDate}-${blockStr}`;
        if (!notifiedBlocksRef.current.has(notifKey) && 'Notification' in window && Notification.permission === 'granted') {
          notifiedBlocksRef.current.add(notifKey);
          const memberName = currentMember?.name || '';
          new Notification('⚠️ 業務遅延アラート', {
            body: `${memberName}さん：「${taskName}」が予定時刻（${scheduledTime}）を30分超過しています。実績を入力してください。`,
            icon: '/favicon.ico',
            tag: notifKey,
          });
        }
      }
    }

    setOverdueAlerts(alerts);
  }, [selectedDate, timelineData, actualTimelineData, currentUserId, currentMember]);

  // Check every 60 seconds
  useEffect(() => {
    checkOverdue();
    const interval = setInterval(checkOverdue, 60_000);
    return () => clearInterval(interval);
  }, [checkOverdue]);

  // Active members (with shifts)
  const activeMembers = useMemo(() => {
    return members.filter(m => shiftsForDate.some(s => s.memberId === m.id));
  }, [members, shiftsForDate]);

  // All unique task names for color mapping (from all timelines)
  const allTaskNames = useMemo(() => {
    const names = new Set<string>();
    tasks.forEach(t => names.add(t.taskName));
    Object.values(timelineData).forEach(mb => {
      Object.values(mb).forEach(tn => names.add(tn));
    });
    Object.values(actualTimelineData).forEach(mb => {
      Object.values(mb).forEach(tn => names.add(tn));
    });
    return Array.from(names).sort();
  }, [tasks, timelineData, actualTimelineData]);

  function getTaskColor(taskName: string): string {
    const idx = allTaskNames.indexOf(taskName);
    return idx >= 0 ? TASK_COLORS[idx % TASK_COLORS.length] : '#9ca3af';
  }

  // Date display
  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              おはようございます、{currentMember?.name || 'ゲスト'}さん
            </h1>
            <p className="text-gray-500 text-sm mt-1">{dateStr}</p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              currentMember?.role === 'employee' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {currentMember?.role === 'employee' ? '社員' : 'アルバイト'}
            </span>
            {currentMember?.isAdmin && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">管理者</span>
            )}
          </div>
        </div>

        {/* Overdue Alerts Banner */}
        {overdueAlerts.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-red-600 text-lg">⚠️</span>
              <h3 className="text-sm font-bold text-red-700">業務遅延アラート（{overdueAlerts.length}件）</h3>
            </div>
            <div className="space-y-1">
              {overdueAlerts.map(a => (
                <div key={a.blockIndex} className="flex items-center gap-2 text-sm text-red-700">
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <span>「{a.taskName}」— 予定 {a.scheduledTime} から30分以上超過。実績を入力してください。</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="到着件数" value={fmtNum(totalShippingRecords)} sub="件" color="blue" />
          <StatCard title="到着点数" value={fmtNum(totalShippingPoints)} sub="点" color="purple" />
          <StatCard title="チーム全体タスク" value={fmtNum(teamPlannedCount)} sub={`実施中: ${fmtNum(teamDoneCount)}`} color="green" />
          <StatCard title="予実差分" value={`${summary.gapMinutes >= 0 ? '+' : ''}${fmtNum(summary.gapMinutes)}分`} sub="実績 - 予定" color="orange" />
        </div>

        {/* Progress Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">自分の進捗</h3>
            <ProgressRing percent={myProgress} />
            <p className="mt-3 text-sm text-gray-500">{fmtNum(myDoneTaskCount)} / {fmtNum(myPlannedTaskCount)} 業務実施中</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">自分のリソース</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">シフト時間</span>
                <span className="text-sm font-bold text-gray-700">{fmtNum(myShiftMinutes)}分 ({(myShiftMinutes / 60).toFixed(1)}h)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-green-600">予定時間（タイムライン）</span>
                <span className="text-sm font-bold text-green-700">{fmtNum(myTimelineTotal)}分</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-blue-600">実績時間（タイムライン）</span>
                <span className="text-sm font-bold text-blue-700">{fmtNum(myActualTimelineTotal)}分</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-gray-500">残り</span>
                <span className={`text-sm font-bold ${(myShiftMinutes - myTimelineTotal) >= 0 ? 'text-gray-600' : 'text-red-600'}`}>
                  {fmtNum(myShiftMinutes - myTimelineTotal)}分
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">チーム全体の進捗</h3>
            <ProgressRing percent={teamProgress} color="#059669" />
            <p className="mt-3 text-sm text-gray-500">{fmtNum(teamDoneCount)} / {fmtNum(teamPlannedCount)} 業務実施中</p>
          </div>
        </div>

        {/* ===== My Timeline ===== */}
        {Object.keys(myBlocks).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 p-6">
            <h3 className="text-sm font-semibold text-green-700 mb-3">自分のタイムライン</h3>
            <div className="overflow-x-auto select-none">
              <div className="flex items-center mb-1">
                <div className="w-16 flex-shrink-0" />
                <div className="flex flex-1">
                  {Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => (
                    <div key={i} className="text-[10px] text-gray-400 text-center" style={{ width: `${100 / (TIMELINE_END - TIMELINE_START)}%` }}>
                      {TIMELINE_START + i}:00
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center">
                <div className="w-16 flex-shrink-0 text-xs font-bold text-green-700 text-right pr-2">
                  {currentMember?.name}
                </div>
                <div className="flex flex-1 h-8 bg-gray-50 rounded overflow-hidden border border-gray-100">
                  {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                    const inShift = myShift ? (() => {
                      const [sh, sm] = myShift.startTime.split(':').map(Number);
                      const [eh, em] = myShift.endTime.split(':').map(Number);
                      const blockStart = TIMELINE_START * 60 + i * 15;
                      return blockStart >= sh * 60 + sm && blockStart < eh * 60 + em;
                    })() : false;
                    const taskName = myBlocks[String(i)];
                    const isHourStart = i % BLOCKS_PER_HOUR === 0;
                    return (
                      <div
                        key={i}
                        className={`h-full ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${inShift ? '' : 'opacity-30'}`}
                        style={{
                          width: `${100 / TOTAL_BLOCKS}%`,
                          backgroundColor: taskName ? getTaskColor(taskName) : (inShift ? '#f9fafb' : '#f3f4f6'),
                        }}
                        title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            {/* My task breakdown */}
            <div className="mt-3 space-y-1">
              {Object.entries(myTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => (
                <div key={taskName} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                  <span className="text-xs text-gray-700 flex-1">{taskName}</span>
                  <span className="text-xs font-bold text-gray-800">{mins}分</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== My Actual Timeline (clickable/paintable) ===== */}
        <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-6" onMouseUp={handleMouseUp}>
          <h3 className="text-sm font-semibold text-blue-700 mb-3">実績タイムライン（15分単位 / クリックで入力）</h3>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-gray-500">業務選択:</label>
            <select
              value={selectedPaintTask}
              onChange={e => setSelectedPaintTask(e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-xs min-w-[200px]"
            >
              <option value="">-- 業務を選択 --</option>
              {TASK_CATEGORIES.map(cat => {
                const catTasks = tasksByCategory[cat] || [];
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

          {/* Quick task buttons from plan timeline */}
          {Object.keys(myBlocks).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3 pb-2 border-b border-gray-100">
              {Object.entries(myTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName]) => (
                <button
                  key={taskName}
                  onClick={() => setSelectedPaintTask(taskName)}
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors ${
                    selectedPaintTask === taskName ? 'border-gray-800 bg-gray-100 font-bold' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                  {taskName.replace(/^【[^】]+】/, '')}
                </button>
              ))}
            </div>
          )}

          <div className="overflow-x-auto select-none">
            {/* Plan row (read-only reference) */}
            <div className="flex items-center mb-1">
              <div className="w-16 flex-shrink-0" />
              <div className="flex flex-1">
                {Array.from({ length: TIMELINE_END - TIMELINE_START }, (_, i) => (
                  <div key={i} className="text-[10px] text-gray-400 text-center" style={{ width: `${100 / (TIMELINE_END - TIMELINE_START)}%` }}>
                    {TIMELINE_START + i}:00
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center mb-0.5">
              <div className="w-16 flex-shrink-0 text-[10px] font-medium text-green-600 text-right pr-2">予定</div>
              <div className="flex flex-1 h-6 bg-gray-50 rounded overflow-hidden border border-gray-100">
                {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                  const inShift = myShift ? (() => {
                    const [sh, sm] = myShift.startTime.split(':').map(Number);
                    const [eh, em] = myShift.endTime.split(':').map(Number);
                    const blockStart = TIMELINE_START * 60 + i * 15;
                    return blockStart >= sh * 60 + sm && blockStart < eh * 60 + em;
                  })() : false;
                  const taskName = myBlocks[String(i)];
                  const isHourStart = i % BLOCKS_PER_HOUR === 0;
                  return (
                    <div
                      key={i}
                      className={`h-full ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${inShift ? '' : 'opacity-30'}`}
                      style={{
                        width: `${100 / TOTAL_BLOCKS}%`,
                        backgroundColor: taskName ? getTaskColor(taskName) : (inShift ? '#f9fafb' : '#f3f4f6'),
                      }}
                      title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actual row (clickable) */}
            <div className="flex items-center">
              <div className="w-16 flex-shrink-0 text-[10px] font-bold text-blue-600 text-right pr-2">実績</div>
              <div className="flex flex-1 h-8 bg-gray-50 rounded overflow-hidden border border-blue-200">
                {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                  const inShift = myShift ? (() => {
                    const [sh, sm] = myShift.startTime.split(':').map(Number);
                    const [eh, em] = myShift.endTime.split(':').map(Number);
                    const blockStart = TIMELINE_START * 60 + i * 15;
                    return blockStart >= sh * 60 + sm && blockStart < eh * 60 + em;
                  })() : false;
                  const taskName = myActualBlocks[String(i)];
                  const isHourStart = i % BLOCKS_PER_HOUR === 0;
                  return (
                    <div
                      key={i}
                      className={`h-full transition-colors ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${inShift ? 'cursor-pointer hover:opacity-80' : 'opacity-30'}`}
                      style={{
                        width: `${100 / TOTAL_BLOCKS}%`,
                        backgroundColor: taskName ? getTaskColor(taskName) : (inShift ? '#f0f9ff' : '#f3f4f6'),
                      }}
                      title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
                      onMouseDown={() => inShift && handleActualBlockMouseDown(i)}
                      onMouseEnter={() => handleActualBlockMouseEnter(i)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actual task breakdown */}
          {Object.keys(myActualTimelineTasks).length > 0 && (
            <div className="mt-3 space-y-1">
              {Object.entries(myActualTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => (
                <div key={taskName} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                  <span className="text-xs text-gray-700 flex-1">{taskName}</span>
                  <span className="text-xs font-bold text-blue-800">{mins}分</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
                <span className="text-xs font-bold text-gray-700 flex-1">合計</span>
                <span className="text-xs font-bold text-blue-700">{myActualTimelineTotal}分</span>
              </div>
            </div>
          )}
        </div>

        {/* ===== Team Timeline (all members) ===== */}
        {activeMembers.length > 0 && Object.keys(timelineData).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">チーム全体のタイムライン</h3>
            <div className="overflow-x-auto select-none">
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
              {activeMembers.map(m => {
                const shift = shiftsForDate.find(s => s.memberId === m.id);
                const memberBlocks = timelineData[m.id] || {};
                const totalMins = Object.keys(memberBlocks).length * 15;
                const isMe = m.id === currentUserId;

                return (
                  <div key={m.id} className={`flex items-center mb-1 ${isMe ? 'bg-green-50/50 rounded' : ''}`}>
                    <div className={`w-20 flex-shrink-0 text-xs font-medium text-right pr-2 truncate ${isMe ? 'text-green-700 font-bold' : 'text-gray-700'}`}>
                      {m.name}{isMe ? ' ★' : ''}
                    </div>
                    <div className="flex flex-1 h-7 bg-gray-50 rounded overflow-hidden border border-gray-100">
                      {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                        const inShift = shift ? (() => {
                          const [sh, sm] = shift.startTime.split(':').map(Number);
                          const [eh, em] = shift.endTime.split(':').map(Number);
                          const blockStart = TIMELINE_START * 60 + i * 15;
                          return blockStart >= sh * 60 + sm && blockStart < eh * 60 + em;
                        })() : false;
                        const taskName = memberBlocks[String(i)];
                        const isHourStart = i % BLOCKS_PER_HOUR === 0;
                        return (
                          <div
                            key={i}
                            className={`h-full ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${inShift ? '' : 'opacity-30'}`}
                            style={{
                              width: `${100 / TOTAL_BLOCKS}%`,
                              backgroundColor: taskName ? getTaskColor(taskName) : (inShift ? '#f9fafb' : '#f3f4f6'),
                            }}
                            title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
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
            {/* Color legend */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-100">
              {allTaskNames.map(name => (
                <span key={name} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(name) }} />
                  {name.replace(/^【[^】]+】/, '')}
                </span>
              ))}
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
