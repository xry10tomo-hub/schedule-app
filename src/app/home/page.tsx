'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, getShippingRecords, getShifts, getTimelineForDate, getActualTimelineForDate, setActualTimelineForDate, getActualPerformanceForDate, setActualPerformanceForDate, getTaskDefinitions, calculateDailySummary, getCategoryTaskColor, getHandovers, setHandovers, getMemberById, CATEGORY_COLORS, TASK_CATEGORIES, fmtNum } from '@/lib/store';
import type { ActualPerformanceEntry } from '@/lib/store';
import type { DailyTask, ShippingRecord, ShiftEntry, TaskDefinition, HandoverRequest } from '@/lib/types';

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

// Use category-based colors (defined in store.ts)

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
  const [performanceData, setPerformanceData] = useState<Record<string, Record<string, ActualPerformanceEntry>>>({});
  const [handovers, setHandoversState] = useState<HandoverRequest[]>([]);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [showTaskSearchDropdown, setShowTaskSearchDropdown] = useState(false);
  const taskSearchRef = useRef<HTMLDivElement>(null);
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
    setHandoversState(getHandovers().filter(h => h.targetDate === selectedDate && (h.status === 'shared' || h.status === 'approved')));
    setPerformanceData(getActualPerformanceForDate(selectedDate));
  }, [selectedDate, dataVersion, currentUserId]);

  // Task performance tracking config
  const TASK_PERF_CONFIG: Record<string, { count?: boolean; points?: boolean }> = {
    '【LINE】画像査定': { points: true },
    '【査定】計算書作成': { count: true, points: true },
    '【査定】計算書提出': { count: true },
    '【査定】計算書（下書き）': { count: true },
    '【補助】郵送物開封': { count: true },
    '【補助】返送': { count: true },
    '【営業】商材追い電話': { count: true, points: true },
  };

  // Get speed rating (minutes per 1 point) from member management
  function getSpeedPerPoint(taskName: string): number | null {
    if (!currentMember) return null;
    const minutesPerUnit = currentMember.speedRatings[taskName];
    if (!minutesPerUnit || minutesPerUnit <= 0) return null;
    return minutesPerUnit;
  }

  // Calculate target points from member's speedRatings and allocated minutes
  function getTargetPoints(taskName: string, minutes: number): number | null {
    const speed = getSpeedPerPoint(taskName);
    if (!speed || minutes <= 0) return null;
    return Math.round((minutes / speed) * 10) / 10;
  }

  // Get my performance entry for a task
  function getMyPerformance(taskName: string): ActualPerformanceEntry | null {
    return performanceData[currentUserId]?.[taskName] || null;
  }

  // Save performance entry for a specific field
  function saveMyPerformance(taskName: string, field: 'count' | 'points', value: number) {
    const newData = { ...performanceData };
    if (!newData[currentUserId]) newData[currentUserId] = {};
    if (!newData[currentUserId][taskName]) newData[currentUserId][taskName] = { count: 0, points: 0 };
    newData[currentUserId][taskName][field] = value;
    setPerformanceData(newData);
    setActualPerformanceForDate(selectedDate, newData);
  }

  // Handover handlers
  function reloadHandovers() {
    setHandoversState(getHandovers().filter(h => h.targetDate === selectedDate && (h.status === 'shared' || h.status === 'approved')));
  }
  function toggleHandoverComplete(id: string) {
    const all = getHandovers().map(h => h.id === id ? {
      ...h,
      completed: !h.completed,
      completedAt: !h.completed ? Date.now() : 0,
      completedBy: !h.completed ? currentUserId : '',
    } : h);
    setHandovers(all);
    reloadHandovers();
  }
  function deleteHandover(id: string) {
    if (!confirm('この共有を削除しますか？')) return;
    const all = getHandovers().filter(h => h.id !== id);
    setHandovers(all);
    reloadHandovers();
  }

  const summary = calculateDailySummary(selectedDate);

  const totalShippingRecords = shippingRecords.length;
  const totalShippingPoints = shippingRecords.reduce((s, r) => s + r.points, 0);

  // Shipping dashboard calculations (mirror of shipping page)
  const todayShipRecords = shippingRecords.filter(r => (r.dayType || '当日') === '当日');
  const ryojitsuShipRecords = shippingRecords.filter(r => (r.dayType || '') === '両日');
  const todayTotalCnt = todayShipRecords.length;
  const todayTotalPts = todayShipRecords.reduce((s, r) => s + r.points, 0);
  const todayDoneShipRecords = todayShipRecords.filter(r => r.creator);
  const todayDoneCnt = todayDoneShipRecords.length;
  const todayDonePts = todayDoneShipRecords.reduce((s, r) => s + r.points, 0);
  const todayRemainCnt = todayTotalCnt - todayDoneCnt;
  const todayRemainPts = todayTotalPts - todayDonePts;
  const ryojitsuTotalCnt = ryojitsuShipRecords.length;
  const ryojitsuTotalPts = ryojitsuShipRecords.reduce((s, r) => s + r.points, 0);
  const ryojitsuDoneShipRecords = ryojitsuShipRecords.filter(r => r.creator);
  const ryojitsuDoneCnt = ryojitsuDoneShipRecords.length;
  const ryojitsuDonePts = ryojitsuDoneShipRecords.reduce((s, r) => s + r.points, 0);
  const ryojitsuRemainCnt = ryojitsuTotalCnt - ryojitsuDoneCnt;
  const ryojitsuRemainPts = ryojitsuTotalPts - ryojitsuDonePts;
  const assessPlannedPoints = tasks.filter(t => t.taskName === '【査定】計算書作成').reduce((s, t) => s + t.plannedCount, 0);
  const assessPlannedCount = tasks.filter(t => t.taskName === '【補助】郵送物開封').reduce((s, t) => s + t.plannedCount, 0);
  const todayRemainResource = todayRemainPts * 2;
  const ryojitsuRemainResource = ryojitsuRemainPts * 2;

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

  // My daily tasks as fallback (when no timeline is painted)
  const myDailyTasks = useMemo(() => {
    // Prefer assigned/unassigned tasks, fall back to all tasks so everyone sees the day's planned work
    const mine = tasks.filter(t => t.assigneeId === currentUserId || t.assigneeId === '');
    return mine.length > 0 ? mine : tasks;
  }, [tasks, currentUserId]);

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
    // Allow dragging even without shift (use full 8:00-22:00 range)
    const isClickable = true; // Allow clicking any time block (not restricted to shift)
    if (!isClickable) return;

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

  // Close task search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (taskSearchRef.current && !taskSearchRef.current.contains(e.target as Node)) {
        setShowTaskSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered tasks for search dropdown
  const filteredSearchTasks = useMemo(() => {
    const q = taskSearchQuery.toLowerCase();
    return taskDefs.filter(t => !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
  }, [taskDefs, taskSearchQuery]);

  // Category color helpers for dropdown styling
  function getCategoryBgColor(category: string): string {
    const colors = CATEGORY_COLORS[category];
    return colors ? colors[0] + '20' : '#9ca3af20';
  }
  function getCategoryTextColor(category: string): string {
    const colors = CATEGORY_COLORS[category];
    return colors ? colors[0] : '#9ca3af';
  }

  // ===== Browser notification for overdue tasks =====
  const notifiedBlocksRef = useRef<Set<string>>(new Set());
  const [overdueAlerts, setOverdueAlerts] = useState<{ blockIndex: number; taskName: string; scheduledTime: string }[]>([]);
  const [teamOverdueAlerts, setTeamOverdueAlerts] = useState<{ memberId: string; memberName: string; blockIndex: number; taskName: string; scheduledTime: string }[]>([]);
  const [toastVisible, setToastVisible] = useState(true); // on-screen overlay toast visibility

  // Request desktop notification permission for own overdue alerts
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
      setTeamOverdueAlerts([]);
      return;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // === Own alerts (on-screen banner only, no desktop notification) ===
    const planned = timelineData[currentUserId] || {};
    const actual = actualTimelineData[currentUserId] || {};
    const alerts: { blockIndex: number; taskName: string; scheduledTime: string }[] = [];

    for (const [blockStr, taskName] of Object.entries(planned)) {
      const blockIndex = Number(blockStr);
      const blockEndMinutes = TIMELINE_START * 60 + (blockIndex + 1) * 15;
      if (currentMinutes >= blockEndMinutes + 30 && !actual[blockStr]) {
        const scheduledTime = blockToTime(blockIndex);
        alerts.push({ blockIndex, taskName, scheduledTime });

        // New alert detected → desktop notification (own only) + on-screen banner
        const notifKey = `${selectedDate}-own-${blockStr}`;
        if (!notifiedBlocksRef.current.has(notifKey)) {
          notifiedBlocksRef.current.add(notifKey);
          setToastVisible(true);
          // Desktop notification for OWN overdue (PC corner alert)
          if ('Notification' in window && Notification.permission === 'granted') {
            const memberName = currentMember?.name || '';
            new Notification('⚠️ 業務遅延アラート', {
              body: `${memberName}さん：「${taskName}」が予定時刻（${scheduledTime}）を30分超過しています。実績を入力してください。`,
              icon: '/favicon.ico',
              tag: notifKey,
              requireInteraction: true,
              silent: true,
            });
          }
        }
      }
    }
    setOverdueAlerts(alerts);

    // === Team overdue alerts (shared on every user's home page) ===
    const teamAlerts: { memberId: string; memberName: string; blockIndex: number; taskName: string; scheduledTime: string }[] = [];
    for (const member of members) {
      if (member.id === currentUserId) continue; // skip self (already in own alerts)
      const memberPlanned = timelineData[member.id] || {};
      const memberActual = actualTimelineData[member.id] || {};
      for (const [blockStr, taskName] of Object.entries(memberPlanned)) {
        const blockIndex = Number(blockStr);
        const blockEndMinutes = TIMELINE_START * 60 + (blockIndex + 1) * 15;
        if (currentMinutes >= blockEndMinutes + 30 && !memberActual[blockStr]) {
          const scheduledTime = blockToTime(blockIndex);
          teamAlerts.push({ memberId: member.id, memberName: member.name, blockIndex, taskName, scheduledTime });
        }
      }
    }
    setTeamOverdueAlerts(teamAlerts);
  }, [selectedDate, timelineData, actualTimelineData, currentUserId, members, currentMember]);

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
    return getCategoryTaskColor(taskName);
  }

  // Date display
  const dateObj = new Date(selectedDate + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  return (
    <DashboardLayout>
      {/* Fixed-position overdue alert overlay (always visible on screen) */}
      {(overdueAlerts.length > 0 || teamOverdueAlerts.length > 0) && toastVisible && (
        <div className="fixed top-4 right-4 z-[9999] max-w-md w-[92vw] sm:w-auto animate-fade-in space-y-2">
          {/* Own alerts */}
          {overdueAlerts.length > 0 && (
            <div className="bg-red-600 text-white rounded-xl shadow-2xl border-2 border-red-800 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl animate-pulse">⚠️</span>
                  <h3 className="text-sm font-extrabold">自分の業務遅延（{overdueAlerts.length}件）</h3>
                </div>
                <button
                  onClick={() => setToastVisible(false)}
                  className="text-white/80 hover:text-white text-lg leading-none"
                  title="閉じる"
                >✕</button>
              </div>
              <div className="space-y-1.5 max-h-[30vh] overflow-y-auto">
                {overdueAlerts.map(a => (
                  <div key={a.blockIndex} className="flex items-start gap-2 text-xs bg-red-700/50 rounded px-2 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white flex-shrink-0 mt-1" />
                    <span>「{a.taskName}」— 予定 <strong>{a.scheduledTime}</strong> から30分以上超過。実績を入力してください。</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Team alerts (other members) */}
          {teamOverdueAlerts.length > 0 && (
            <div className="bg-orange-500 text-white rounded-xl shadow-2xl border-2 border-orange-700 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔔</span>
                  <h3 className="text-sm font-extrabold">チーム業務遅延（{teamOverdueAlerts.length}件）</h3>
                </div>
                {overdueAlerts.length === 0 && (
                  <button
                    onClick={() => setToastVisible(false)}
                    className="text-white/80 hover:text-white text-lg leading-none"
                    title="閉じる"
                  >✕</button>
                )}
              </div>
              <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                {(() => {
                  // Group by member
                  const byMember = new Map<string, typeof teamOverdueAlerts>();
                  for (const a of teamOverdueAlerts) {
                    if (!byMember.has(a.memberId)) byMember.set(a.memberId, []);
                    byMember.get(a.memberId)!.push(a);
                  }
                  return Array.from(byMember.entries()).map(([mid, items]) => (
                    <div key={mid} className="bg-orange-600/50 rounded px-2 py-1.5">
                      <p className="text-xs font-bold mb-0.5">{items[0].memberName}さん</p>
                      {items.map(a => (
                        <div key={`${mid}-${a.blockIndex}`} className="flex items-start gap-2 text-[11px] ml-2">
                          <span className="w-1 h-1 rounded-full bg-white flex-shrink-0 mt-1.5" />
                          <span>「{a.taskName}」— 予定 <strong>{a.scheduledTime}</strong> から30分超過</span>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {currentMember?.id === 'kumagai'
                ? '豚、ブタ、ぶたーさん おはようございます。ぶたぶたぶたぶたぶたーた'
                : `${currentMember?.name || 'ゲスト'}さんおはようございます`}
            </h1>
            <p className="text-gray-500 text-sm mt-1">{dateStr}</p>
          </div>
          <div className="flex gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              currentMember?.role === 'employee' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {currentMember?.role === 'employee' ? '社員' : 'アルバイト'}
            </span>
          </div>
        </div>

        {/* Own Overdue Alerts Banner */}
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

        {/* Task composition chart - 業務構成比 (above 郵送点数) */}
        {(() => {
          const todayShifts = getShifts().filter(s => s.date === selectedDate);
          const totalShiftMinutes = todayShifts.reduce((sum, s) => {
            const [sh, sm] = s.startTime.split(':').map(Number);
            const [eh, em] = s.endTime.split(':').map(Number);
            return sum + (eh * 60 + em - sh * 60 - sm);
          }, 0);
          const taskMinutes: Record<string, number> = {};
          Object.values(timelineData).forEach(memberBlocks => {
            Object.values(memberBlocks).forEach(taskName => {
              taskMinutes[taskName] = (taskMinutes[taskName] || 0) + 15;
            });
          });
          const sortedTasks = Object.entries(taskMinutes).sort((a, b) => b[1] - a[1]);
          const totalPlannedMin = sortedTasks.reduce((s, [, m]) => s + m, 0);
          const denominator = totalShiftMinutes > 0 ? totalShiftMinutes : Math.max(totalPlannedMin, 1);
          const remaining = Math.max(0, totalShiftMinutes - totalPlannedMin);
          return (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-bold text-gray-700">📊 業務構成比（本日のリソース基準）</h3>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-500">本日のリソース: <b className="text-gray-700">{totalShiftMinutes}分 ({(totalShiftMinutes/60).toFixed(1)}h)</b></span>
                  <span className="text-gray-500">予定合計: <b className="text-green-700">{totalPlannedMin}分</b></span>
                  <span className="text-gray-500">残り: <b className={remaining >= 0 ? 'text-blue-700' : 'text-red-600'}>{remaining}分</b></span>
                </div>
              </div>
              <div className="h-7 w-full rounded-lg overflow-hidden border border-gray-200 flex bg-gray-50">
                {sortedTasks.map(([taskName, mins]) => {
                  const pct = (mins / denominator) * 100;
                  return (
                    <div
                      key={taskName}
                      className="h-full flex items-center justify-center text-[9px] text-white font-bold transition-all hover:opacity-80"
                      style={{ width: `${pct}%`, backgroundColor: getTaskColor(taskName) }}
                      title={`${taskName}: ${mins}分 (${pct.toFixed(1)}%)`}
                    >
                      {pct >= 5 ? `${pct.toFixed(0)}%` : ''}
                    </div>
                  );
                })}
                {remaining > 0 && totalShiftMinutes > 0 && (
                  <div className="h-full bg-gray-200 flex items-center justify-center text-[9px] text-gray-500" style={{ width: `${(remaining / denominator) * 100}%` }} title={`残り: ${remaining}分`}>
                    残り
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-3">
                {sortedTasks.map(([taskName, mins]) => {
                  const pct = (mins / denominator) * 100;
                  return (
                    <div key={taskName} className="flex items-center gap-2 text-xs">
                      <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                      <span className="flex-1 text-gray-700 truncate" title={taskName}>{taskName.replace(/^【[^】]+】/, '')}</span>
                      <span className="text-gray-500 text-[10px]">{mins}分</span>
                      <span className="text-gray-800 font-bold text-[10px]">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
                {sortedTasks.length === 0 && (
                  <p className="text-xs text-gray-400 col-span-full text-center py-2">タイムライン未設定です。</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Shipping Dashboard - graphical version */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-5">
          <h3 className="text-sm font-bold text-gray-700">📦 郵送点数 進捗グラフ</h3>

          {/* Top KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-3">
              <p className="text-[10px] text-indigo-600 font-bold">実査定 予定点数</p>
              <p className="text-2xl font-extrabold text-indigo-700">{fmtNum(assessPlannedPoints)}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-3">
              <p className="text-[10px] text-indigo-600 font-bold">実査定 予定件数</p>
              <p className="text-2xl font-extrabold text-indigo-700">{fmtNum(assessPlannedCount)}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-3">
              <p className="text-[10px] text-red-600 font-bold">当日 残りリソース</p>
              <p className="text-2xl font-extrabold text-red-700">{fmtNum(todayRemainResource)}<span className="text-sm">分</span></p>
              <p className="text-[10px] text-red-400">（{fmtNum(todayRemainPts)}点 × 2分）</p>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-3">
              <p className="text-[10px] text-orange-600 font-bold">両日 残りリソース</p>
              <p className="text-2xl font-extrabold text-orange-700">{fmtNum(ryojitsuRemainResource)}<span className="text-sm">分</span></p>
              <p className="text-[10px] text-orange-400">（{fmtNum(ryojitsuRemainPts)}点 × 2分）</p>
            </div>
          </div>

          {/* Progress bars: 当日 / 両日 / 合計 */}
          {(() => {
            const totalCnt = todayTotalCnt + ryojitsuTotalCnt;
            const totalPts = todayTotalPts + ryojitsuTotalPts;
            const totalDoneCnt = todayDoneCnt + ryojitsuDoneCnt;
            const totalDonePts = todayDonePts + ryojitsuDonePts;
            const ProgressBar = ({ label, done, total, color }: { label: string; done: number; total: number; color: string }) => {
              const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
              return (
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-bold text-gray-700">{label}</span>
                    <span className="text-gray-500"><b className={color}>{done}</b> / {total} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--tw-gradient-stops))` }}>
                      <div className={`h-full ${color.replace('text-', 'bg-')}`} style={{ width: '100%' }} />
                    </div>
                  </div>
                </div>
              );
            };
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* 当日 */}
                <div className="border border-blue-100 rounded-lg p-3 bg-blue-50/30 space-y-2">
                  <h4 className="text-xs font-bold text-blue-700">当日</h4>
                  <ProgressBar label="件数" done={todayDoneCnt} total={todayTotalCnt} color="text-blue-600" />
                  <ProgressBar label="点数" done={todayDonePts} total={todayTotalPts} color="text-blue-600" />
                  <p className="text-[10px] text-red-500">残り {todayRemainCnt}件 / {todayRemainPts}点</p>
                </div>
                {/* 両日 */}
                <div className="border border-purple-100 rounded-lg p-3 bg-purple-50/30 space-y-2">
                  <h4 className="text-xs font-bold text-purple-700">両日</h4>
                  <ProgressBar label="件数" done={ryojitsuDoneCnt} total={ryojitsuTotalCnt} color="text-purple-600" />
                  <ProgressBar label="点数" done={ryojitsuDonePts} total={ryojitsuTotalPts} color="text-purple-600" />
                  <p className="text-[10px] text-orange-500">残り {ryojitsuRemainCnt}件 / {ryojitsuRemainPts}点</p>
                </div>
                {/* 合計 - full width */}
                <div className="border-2 border-gray-300 rounded-lg p-3 bg-gray-50 space-y-2 md:col-span-2">
                  <h4 className="text-xs font-bold text-gray-700">合計</h4>
                  <ProgressBar label="件数" done={totalDoneCnt} total={totalCnt} color="text-gray-700" />
                  <ProgressBar label="点数" done={totalDonePts} total={totalPts} color="text-gray-700" />
                </div>
              </div>
            );
          })()}

          {/* 当日 vs 両日 構成比 - donut/stacked bar */}
          {(todayTotalPts + ryojitsuTotalPts) > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-xs font-bold text-gray-700 mb-2">📊 当日 vs 両日 構成比（点数）</h4>
              {(() => {
                const tot = todayTotalPts + ryojitsuTotalPts;
                const tdPct = (todayTotalPts / tot) * 100;
                const ryPct = (ryojitsuTotalPts / tot) * 100;
                return (
                  <>
                    <div className="h-6 w-full rounded-lg overflow-hidden border border-gray-200 flex">
                      <div className="h-full bg-blue-500 flex items-center justify-center text-[10px] text-white font-bold" style={{ width: `${tdPct}%` }}>
                        {tdPct >= 10 ? `当日 ${tdPct.toFixed(0)}%` : ''}
                      </div>
                      <div className="h-full bg-purple-500 flex items-center justify-center text-[10px] text-white font-bold" style={{ width: `${ryPct}%` }}>
                        {ryPct >= 10 ? `両日 ${ryPct.toFixed(0)}%` : ''}
                      </div>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-sm" />当日: <b>{todayTotalPts}点</b> ({tdPct.toFixed(1)}%)</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 bg-purple-500 rounded-sm" />両日: <b>{ryojitsuTotalPts}点</b> ({ryPct.toFixed(1)}%)</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* ===== Today's Handovers (moved above My Timeline) ===== */}
        {handovers.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-6">
            <h3 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
              🔄 本日の引き継ぎ業務
              <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">{handovers.length}件</span>
            </h3>
            <div className="space-y-2">
              {handovers.map(h => {
                const applicant = getMemberById(h.applicantId);
                const isOwn = h.applicantId === currentUserId;
                const isCompleted = !!h.completed;
                return (
                  <div key={h.id} className={`rounded-lg p-3 border ${isCompleted ? 'bg-gray-50 border-gray-200 opacity-60' : isOwn ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isCompleted}
                        onChange={() => toggleHandoverComplete(h.id)}
                        className="w-4 h-4 mt-0.5 accent-green-600 cursor-pointer flex-shrink-0"
                        title="完了チェック"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isCompleted ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600">完了</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">未完了</span>
                          )}
                          <span className={`text-sm font-bold text-gray-800 ${isCompleted ? 'line-through' : ''}`}>{h.taskName}</span>
                          <span className="text-xs text-gray-500">by {applicant?.name || h.applicantId}</span>
                          {isOwn && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">自分</span>}
                        </div>
                        {h.reason && <p className={`text-xs text-gray-600 mt-1 ${isCompleted ? 'line-through' : ''}`}>💬 {h.reason}</p>}
                        {h.detail && <p className={`text-xs text-gray-600 whitespace-pre-wrap bg-gray-50 rounded px-2 py-1 mt-1 ${isCompleted ? 'line-through' : ''}`}>📝 {h.detail}</p>}
                      </div>
                      {isOwn && !isCompleted && (
                        <button onClick={() => deleteHandover(h.id)} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">削除</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">※ 編集は「引き継ぎ共有BOX」画面から行ってください</p>
          </div>
        )}

        {/* ===== My Timeline ===== */}
        <div className="bg-white rounded-xl shadow-sm border border-green-200 p-6">
          <h3 className="text-sm font-semibold text-green-700 mb-3">自分の予定業務</h3>
          {Object.keys(myBlocks).length > 0 ? (
            <>
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
                {Object.entries(myTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => {
                  const speedPP = getSpeedPerPoint(taskName);
                  const targetPts = getTargetPoints(taskName, mins);
                  return (
                    <div key={taskName} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                      <span className="text-xs text-gray-700 flex-1">{taskName}</span>
                      {speedPP !== null && (
                        <span className="text-[10px] text-orange-600">({speedPP}分/点)</span>
                      )}
                      {targetPts !== null && (
                        <span className="text-xs font-bold text-purple-600">目標 {targetPts}点</span>
                      )}
                      <span className="text-xs font-bold text-gray-800">{mins}分</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Fallback: show daily tasks list when no timeline blocks are painted */
            myDailyTasks.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 mb-2">※ タイムラインが未設定のため、日次タスク一覧を表示しています</p>
                {myDailyTasks.map(t => {
                  const speedPP = getSpeedPerPoint(t.taskName);
                  const targetPts = getTargetPoints(t.taskName, t.plannedMinutes);
                  return (
                    <div key={t.id} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(t.taskName) }} />
                      <span className="text-xs text-gray-700 flex-1">{t.taskName}</span>
                      {speedPP !== null && (
                        <span className="text-[10px] text-orange-600">({speedPP}分/点)</span>
                      )}
                      {targetPts !== null && (
                        <span className="text-xs font-bold text-purple-600">目標 {targetPts}点</span>
                      )}
                      <span className="text-xs font-bold text-gray-800">{t.plannedMinutes}分</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-4">本日の予定業務がありません。日次業務入力画面でタスクを追加してください。</p>
            )
          )}
        </div>

        {/* ===== My Actual Timeline (clickable/paintable) ===== */}
        <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-6" onMouseUp={handleMouseUp}>
          <h3 className="text-sm font-semibold text-blue-700 mb-3">実績タイムライン（15分単位 / クリックで入力）</h3>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <label className="text-xs text-gray-500">業務選択:</label>
            <div className="relative" ref={taskSearchRef}>
              <input
                type="text"
                placeholder="業務名で検索..."
                value={showTaskSearchDropdown ? taskSearchQuery : (selectedPaintTask || '')}
                onChange={e => { setTaskSearchQuery(e.target.value); setShowTaskSearchDropdown(true); }}
                onFocus={() => { setTaskSearchQuery(''); setShowTaskSearchDropdown(true); }}
                className="border rounded-lg px-3 py-1.5 text-xs min-w-[280px] bg-white"
              />
              {selectedPaintTask && !showTaskSearchDropdown && (
                <button onClick={() => { setSelectedPaintTask(''); setTaskSearchQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
              {showTaskSearchDropdown && (
                <div className="absolute z-50 mt-1 w-[360px] max-h-[400px] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                  {TASK_CATEGORIES.map(cat => {
                    const catTasks = filteredSearchTasks.filter(t => t.category === cat);
                    if (catTasks.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 z-10"
                          style={{ backgroundColor: getCategoryBgColor(cat), color: getCategoryTextColor(cat) }}>
                          {cat}
                        </div>
                        {catTasks.map(t => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setSelectedPaintTask(t.name);
                              setTaskSearchQuery('');
                              setShowTaskSearchDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2 ${
                              selectedPaintTask === t.name ? 'bg-blue-50 font-bold' : ''
                            }`}
                          >
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(t.name) }} />
                            {t.name}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {filteredSearchTasks.length === 0 && (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">該当する業務がありません</div>
                  )}
                </div>
              )}
            </div>
            {selectedPaintTask && (
              <span className="flex items-center gap-1 text-xs bg-gray-50 px-2 py-1 rounded">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getTaskColor(selectedPaintTask) }} />
                {selectedPaintTask.replace(/^【[^】]+】/, '')}
              </span>
            )}
          </div>

          {/* Quick task buttons from plan timeline or daily tasks */}
          {(() => {
            const quickTasks = Object.keys(myTimelineTasks).length > 0
              ? Object.entries(myTimelineTasks).sort((a, b) => b[1] - a[1]).map(([tn]) => tn)
              : myDailyTasks.map(t => t.taskName);
            const uniqueQuickTasks = Array.from(new Set(quickTasks));
            return uniqueQuickTasks.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3 pb-2 border-b border-gray-100">
                {uniqueQuickTasks.map(taskName => (
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
            );
          })()}

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
                  // Allow clicking even without shift (use 8:00-22:00 range)
                  const isClickable = true; // Allow clicking any time block (not restricted to shift)
                  const taskName = myActualBlocks[String(i)];
                  const isHourStart = i % BLOCKS_PER_HOUR === 0;
                  return (
                    <div
                      key={i}
                      className={`h-full transition-colors ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${isClickable ? 'cursor-pointer hover:opacity-80' : 'opacity-30'}`}
                      style={{
                        width: `${100 / TOTAL_BLOCKS}%`,
                        backgroundColor: taskName ? getTaskColor(taskName) : (isClickable ? '#f0f9ff' : '#f3f4f6'),
                      }}
                      title={taskName ? `${blockToTime(i)} - ${taskName}` : blockToTime(i)}
                      onMouseDown={() => isClickable && handleActualBlockMouseDown(i)}
                      onMouseEnter={() => handleActualBlockMouseEnter(i)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actual task breakdown */}
          {Object.keys(myActualTimelineTasks).length > 0 && (
            <div className="mt-3 space-y-2">
              {Object.entries(myActualTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => {
                const perfConfig = TASK_PERF_CONFIG[taskName];
                const perf = getMyPerformance(taskName);
                const speedPP = getSpeedPerPoint(taskName);
                const targetPts = getTargetPoints(taskName, myTimelineTasks[taskName] || 0);
                // For these tasks, calculate avg speed per point instead of per count
                const POINTS_BASED_SPEED_TASKS = ['【LINE】画像査定', '【査定】計算書作成', '【営業】商材追い電話'];
                const useSpeedPerPoint = POINTS_BASED_SPEED_TASKS.includes(taskName);
                const avgSpeedUnit = useSpeedPerPoint ? '点' : '件';
                const denom = useSpeedPerPoint ? (perf?.points || 0) : (perf?.count || 0);
                const avgSpeed = denom > 0 && mins > 0 ? Math.round((mins / denom) * 10) / 10 : null;
                return (
                  <div key={taskName} className={`rounded-lg ${perfConfig ? 'bg-blue-50/50 p-2' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                      <span className="text-xs text-gray-700 flex-1">{taskName}</span>
                      {speedPP !== null && <span className="text-[10px] text-orange-600">({speedPP}分/点)</span>}
                      {targetPts !== null && <span className="text-[10px] text-purple-600">目標{targetPts}点</span>}
                      <span className="text-xs font-bold text-blue-800">{mins}分</span>
                    </div>
                    {perfConfig && (
                      <div className="ml-5 mt-1.5 flex items-center gap-3 flex-wrap">
                        {perfConfig.count && (
                          <div className="flex items-center gap-1">
                            <label className="text-[10px] text-gray-500">件数:</label>
                            <input type="number" min="0" value={perf?.count || 0}
                              onChange={e => saveMyPerformance(taskName, 'count', Number(e.target.value))}
                              className="w-16 border rounded px-1.5 py-0.5 text-xs text-center bg-white" />
                          </div>
                        )}
                        {perfConfig.points && (
                          <div className="flex items-center gap-1">
                            <label className="text-[10px] text-gray-500">点数:</label>
                            <input type="number" min="0" value={perf?.points || 0}
                              onChange={e => saveMyPerformance(taskName, 'points', Number(e.target.value))}
                              className="w-16 border rounded px-1.5 py-0.5 text-xs text-center bg-white" />
                          </div>
                        )}
                        {avgSpeed !== null && (
                          <span className="text-[10px] text-green-700 font-bold">平均 {avgSpeed}分/{avgSpeedUnit}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
