'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, setDailyTasks, getShifts, getTimelineForDate, setTimelineForDate, getCategoryTaskColor, getTaskAssignments, DEFAULT_TASKS, TASK_CATEGORIES, fmtNum } from '@/lib/store';
import type { DailyTask, Member, ShiftEntry } from '@/lib/types';

// ===== Timeline Constants =====
const TIMELINE_START = 8; // 8:00
const TIMELINE_END = 22; // 22:00
const BLOCKS_PER_HOUR = 4; // 15-min blocks
const TOTAL_BLOCKS = (TIMELINE_END - TIMELINE_START) * BLOCKS_PER_HOUR; // 56

// Break window: 11:30-13:30
const BREAK_WINDOW_START_BLOCK = (11.5 - TIMELINE_START) * BLOCKS_PER_HOUR; // 14
const BREAK_DURATION_BLOCKS = 4; // 1 hour = 4 blocks
const BREAK_TASK_NAME = '【他】休憩';

// Use category-based colors (defined in store.ts)

function blockToTime(blockIndex: number): string {
  const totalMinutes = TIMELINE_START * 60 + blockIndex * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function getShiftBlocks(shift: ShiftEntry): { start: number; end: number } {
  const [sh, sm] = shift.startTime.split(':').map(Number);
  const [eh, em] = shift.endTime.split(':').map(Number);
  const start = Math.max(0, Math.floor(((sh * 60 + sm) - TIMELINE_START * 60) / 15));
  const end = Math.min(TOTAL_BLOCKS, Math.ceil(((eh * 60 + em) - TIMELINE_START * 60) / 15));
  return { start, end };
}

// ===== Auto-Assign Algorithm =====
interface AssignableTask {
  taskName: string;
  blocksNeeded: number;
  assigneeId: string; // empty = unassigned
  priority: number; // lower = more important (derived from min priority across members)
}

function runAutoAssignAlgorithm(
  tasks: DailyTask[],
  activeMembers: Member[],
  shifts: ShiftEntry[]
): Record<string, Record<string, string>> {
  // Result: { [memberId]: { [blockIndex]: taskName } }
  const timeline: Record<string, Record<string, string>> = {};

  // Initialize timeline for each member
  for (const member of activeMembers) {
    timeline[member.id] = {};
  }

  // Track available blocks per member (ordered list of block indices)
  const memberAvailableBlocks: Record<string, number[]> = {};

  for (const member of activeMembers) {
    const shift = shifts.find(s => s.memberId === member.id);
    if (!shift) continue;
    const { start, end } = getShiftBlocks(shift);
    const blocks: number[] = [];
    for (let b = start; b < end; b++) {
      blocks.push(b);
    }
    memberAvailableBlocks[member.id] = blocks;
  }

  // ===== Step 1: Assign breaks =====
  // Stagger breaks within 11:30-13:30 window
  // Group 1: 11:30-12:30 (blocks 14-17)
  // Group 2: 12:30-13:30 (blocks 18-21)
  const membersWithShifts = activeMembers.filter(m => memberAvailableBlocks[m.id]?.length > 0);
  const halfCount = Math.ceil(membersWithShifts.length / 2);

  membersWithShifts.forEach((member, idx) => {
    const breakStartBlock = idx < halfCount
      ? BREAK_WINDOW_START_BLOCK // 11:30
      : BREAK_WINDOW_START_BLOCK + BREAK_DURATION_BLOCKS; // 12:30

    for (let b = breakStartBlock; b < breakStartBlock + BREAK_DURATION_BLOCKS; b++) {
      if (memberAvailableBlocks[member.id]?.includes(b)) {
        timeline[member.id][String(b)] = BREAK_TASK_NAME;
        // Remove from available
        memberAvailableBlocks[member.id] = memberAvailableBlocks[member.id].filter(x => x !== b);
      }
    }
  });

  // ===== Read taskAssignments (per-task config from 日次業務入力) =====
  const taskAssignmentsCfg = getTaskAssignments();

  // ===== Step 2: Place tasks with scheduled times (実施時間) first =====
  const scheduledTasksHandled = new Set<string>();

  for (const task of tasks) {
    if (task.taskName === BREAK_TASK_NAME) continue;
    const cfg = taskAssignmentsCfg[task.taskName];
    if (!cfg) continue;

    // Collect all time ranges (new multi-range format + legacy single)
    const ranges: Array<{ start: string; end: string }> = [];
    if (Array.isArray(cfg.scheduledRanges) && cfg.scheduledRanges.length > 0) {
      for (const r of cfg.scheduledRanges) {
        if (r.start && r.end) ranges.push({ start: r.start, end: r.end });
      }
    } else if (cfg.scheduledStart && cfg.scheduledEnd) {
      ranges.push({ start: cfg.scheduledStart, end: cfg.scheduledEnd });
    }
    if (ranges.length === 0) continue;

    const priorityMembers = (cfg.assignableMemberIds || [])
      .map(id => activeMembers.find(m => m.id === id))
      .filter(Boolean) as Member[];

    for (const range of ranges) {
      const [startH, startM] = range.start.split(':').map(Number);
      const [endH, endM] = range.end.split(':').map(Number);
      const startBlock = Math.floor(((startH * 60 + startM) - TIMELINE_START * 60) / 15);
      const endBlock = Math.floor(((endH * 60 + endM) - TIMELINE_START * 60) / 15);
      if (startBlock < 0 || endBlock <= startBlock || startBlock >= TOTAL_BLOCKS) continue;
      // Place blocks for assignable members in priority order (selected order)
      for (const member of priorityMembers) {
        for (let b = startBlock; b < Math.min(endBlock, TOTAL_BLOCKS); b++) {
          if (memberAvailableBlocks[member.id]?.includes(b)) {
            timeline[member.id][String(b)] = task.taskName;
            memberAvailableBlocks[member.id] = memberAvailableBlocks[member.id].filter(x => x !== b);
          }
        }
      }
    }
    if (priorityMembers.length > 0) scheduledTasksHandled.add(task.taskName);
  }

  // ===== Step 3: Prepare remaining assignable tasks =====
  const assignableTasks: AssignableTask[] = [];

  for (const task of tasks) {
    if (task.taskName === BREAK_TASK_NAME) continue;
    if (scheduledTasksHandled.has(task.taskName)) continue;

    const blocksNeeded = Math.max(1, Math.ceil(task.plannedMinutes / 15));

    assignableTasks.push({
      taskName: task.taskName,
      blocksNeeded,
      assigneeId: task.assigneeId,
      priority: 0, // priority is encoded in member order, not per-task
    });
  }

  // Sort: pre-assigned tasks first, then by blocks needed (larger first)
  assignableTasks.sort((a, b) => {
    const aAssigned = a.assigneeId ? 0 : 1;
    const bAssigned = b.assigneeId ? 0 : 1;
    if (aAssigned !== bAssigned) return aAssigned - bAssigned;
    return b.blocksNeeded - a.blocksNeeded;
  });

  // ===== Step 4: Assign remaining tasks to timeline =====
  for (const task of assignableTasks) {
    let remaining = task.blocksNeeded;

    if (task.assigneeId) {
      const available = memberAvailableBlocks[task.assigneeId] || [];
      const toAssign = Math.min(remaining, available.length);
      for (let i = 0; i < toAssign; i++) {
        timeline[task.assigneeId][String(available[i])] = task.taskName;
      }
      memberAvailableBlocks[task.assigneeId] = available.slice(toAssign);
      remaining -= toAssign;
    }

    if (remaining <= 0) continue;

    // Find capable members from taskAssignments, ordered by selection (= priority)
    const cfg = taskAssignmentsCfg[task.taskName];
    const assignableIds = cfg?.assignableMemberIds || [];
    const capableMembers = assignableIds
      .map(id => activeMembers.find(m => m.id === id))
      .filter((m): m is Member => !!m && m.id !== task.assigneeId);

    for (const member of capableMembers) {
      if (remaining <= 0) break;
      const available = memberAvailableBlocks[member.id] || [];
      if (available.length === 0) continue;

      const toAssign = Math.min(remaining, available.length);
      for (let i = 0; i < toAssign; i++) {
        timeline[member.id][String(available[i])] = task.taskName;
      }
      memberAvailableBlocks[member.id] = available.slice(toAssign);
      remaining -= toAssign;
    }

    // If still remaining and no capable members, assign to least loaded member
    if (remaining > 0) {
      const sortedByLoad = [...membersWithShifts].sort((a, b) =>
        (memberAvailableBlocks[b.id]?.length || 0) - (memberAvailableBlocks[a.id]?.length || 0)
      );
      for (const member of sortedByLoad) {
        if (remaining <= 0) break;
        const available = memberAvailableBlocks[member.id] || [];
        if (available.length === 0) continue;
        const toAssign = Math.min(remaining, available.length);
        for (let i = 0; i < toAssign; i++) {
          timeline[member.id][String(available[i])] = task.taskName;
        }
        memberAvailableBlocks[member.id] = available.slice(toAssign);
        remaining -= toAssign;
      }
    }
  }

  return timeline;
}

// ===== Page Component =====
export default function AutoAssignPage() {
  const { members, dataVersion, selectedDate: date } = useAppContext();
  const [previewTimeline, setPreviewTimeline] = useState<Record<string, Record<string, string>> | null>(null);
  const [tasks, setTasksState] = useState<DailyTask[]>([]);
  const [applied, setApplied] = useState(false);
  const [unassignedWarnings, setUnassignedWarnings] = useState<string[]>([]);

  // Load daily tasks for selected date
  useEffect(() => {
    const allTasks = getDailyTasks().filter(t => t.date === date);
    setTasksState(allTasks);
    setPreviewTimeline(null);
    setApplied(false);
    setUnassignedWarnings([]);
  }, [date, dataVersion]);

  const shiftsForDate = getShifts().filter(s => s.date === date);
  const activeMembers = useMemo(() => {
    return members.filter(m => shiftsForDate.some(s => s.memberId === m.id));
  }, [members, shiftsForDate]);

  // Build unique task names for color mapping
  const allTaskNames = useMemo(() => {
    const names = new Set<string>();
    tasks.forEach(t => names.add(t.taskName));
    if (previewTimeline) {
      Object.values(previewTimeline).forEach(mb => {
        Object.values(mb).forEach(tn => names.add(tn));
      });
    }
    return Array.from(names).sort();
  }, [tasks, previewTimeline]);

  function getTaskColor(taskName: string): string {
    return getCategoryTaskColor(taskName);
  }

  // Run auto-assign
  function handleAutoAssign() {
    if (activeMembers.length === 0) {
      alert('この日にシフト登録されているメンバーがいません。先にシフト一覧でシフトを登録してください。');
      return;
    }
    if (tasks.length === 0) {
      alert('この日の業務タスクがありません。先に日次業務入力でタスクを追加してください。');
      return;
    }

    const result = runAutoAssignAlgorithm(tasks, activeMembers, shiftsForDate);
    setPreviewTimeline(result);
    setApplied(false);

    // Check for unassigned tasks
    const assignedTasks = new Set<string>();
    Object.values(result).forEach(mb => {
      Object.values(mb).forEach(tn => assignedTasks.add(tn));
    });
    const warnings = tasks
      .filter(t => t.taskName !== BREAK_TASK_NAME && !assignedTasks.has(t.taskName))
      .map(t => t.taskName);
    setUnassignedWarnings([...new Set(warnings)]);
  }

  // Apply to timeline
  function handleApplyTimeline() {
    if (!previewTimeline) return;
    setTimelineForDate(date, previewTimeline);

    // Also update assigneeIds in daily tasks based on timeline
    const allDailyTasks = getDailyTasks();
    const taskAssignments: Record<string, Set<string>> = {};
    Object.entries(previewTimeline).forEach(([memberId, blocks]) => {
      Object.values(blocks).forEach(taskName => {
        if (!taskAssignments[taskName]) taskAssignments[taskName] = new Set();
        taskAssignments[taskName].add(memberId);
      });
    });

    // For each daily task, if unassigned, assign to the member who has the most blocks
    const updated = allDailyTasks.map(t => {
      if (t.date !== date) return t;
      if (t.taskName === BREAK_TASK_NAME) return t;
      const assignedMembers = taskAssignments[t.taskName];
      if (!assignedMembers || assignedMembers.size === 0) return t;

      // If task already has assignee and they're in the timeline, keep it
      if (t.assigneeId && assignedMembers.has(t.assigneeId)) return t;

      // Assign to the member with most blocks for this task
      let bestMember = '';
      let bestCount = 0;
      assignedMembers.forEach(mid => {
        const blocks = previewTimeline[mid] || {};
        const count = Object.values(blocks).filter(tn => tn === t.taskName).length;
        if (count > bestCount) { bestCount = count; bestMember = mid; }
      });

      return { ...t, assigneeId: bestMember || t.assigneeId };
    });

    setDailyTasks(updated);
    setApplied(true);
  }

  // Per-member summary from preview
  const memberPreviewSummary = useMemo(() => {
    if (!previewTimeline) return [];
    return activeMembers.map(m => {
      const blocks = previewTimeline[m.id] || {};
      const taskBreakdown: Record<string, number> = {};
      Object.values(blocks).forEach(tn => {
        taskBreakdown[tn] = (taskBreakdown[tn] || 0) + 15;
      });
      const totalMinutes = Object.keys(blocks).length * 15;
      const shift = shiftsForDate.find(s => s.memberId === m.id);
      const shiftMinutes = shift ? (() => {
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const [eh, em] = shift.endTime.split(':').map(Number);
        return (eh * 60 + em) - (sh * 60 + sm);
      })() : 0;
      return {
        member: m,
        totalMinutes,
        shiftMinutes,
        taskBreakdown,
        freeMinutes: shiftMinutes - totalMinutes,
      };
    });
  }, [previewTimeline, activeMembers, shiftsForDate]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">AI自動割振</h1>
            <p className="text-sm text-gray-500 mt-1">
              日次業務入力画面の予定入力（対応可能メンバー・実施時間）から、1日のタイムスケジュールを自動生成します
            </p>
          </div>
          <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">{date}</span>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white rounded-lg px-4 py-3 border border-green-200 shadow-sm">
            <span className="text-xs text-green-600">出勤メンバー</span>
            <p className="text-lg font-bold text-green-700">{fmtNum(activeMembers.length)}名</p>
            <p className="text-[10px] text-gray-400">{activeMembers.map(m => m.name).join('、')}</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-orange-200 shadow-sm">
            <span className="text-xs text-orange-600">本日のタスク</span>
            <p className="text-lg font-bold text-orange-700">{fmtNum(tasks.length)}件</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-blue-200 shadow-sm">
            <span className="text-xs text-blue-600">総必要時間</span>
            <p className="text-lg font-bold text-blue-700">
              {fmtNum(tasks.reduce((s, t) => s + t.plannedMinutes, 0))}分
            </p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-purple-200 shadow-sm">
            <span className="text-xs text-purple-600">総リソース</span>
            <p className="text-lg font-bold text-purple-700">
              {fmtNum(shiftsForDate.reduce((sum, s) => {
                const [sh, sm] = s.startTime.split(':').map(Number);
                const [eh, em] = s.endTime.split(':').map(Number);
                return sum + (eh * 60 + em - sh * 60 - sm);
              }, 0))}分
            </p>
          </div>
        </div>

        {/* Task list preview */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">割振対象タスク</h3>
          {tasks.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">
              タスクがありません。日次業務入力ページでタスクを追加するか、月次カレンダーで予定を登録してください。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-3 py-2 font-medium">業務名</th>
                    <th className="px-3 py-2 font-medium">必要件数</th>
                    <th className="px-3 py-2 font-medium">1回あたり時間</th>
                    <th className="px-3 py-2 font-medium">必要時間</th>
                    <th className="px-3 py-2 font-medium">対応可能メンバー（選択順=優先度）</th>
                    <th className="px-3 py-2 font-medium">実施時間</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const cfgAll = getTaskAssignments();
                    return tasks.filter(t => t.taskName !== BREAK_TASK_NAME).map(t => {
                      const cfg = cfgAll[t.taskName] || { assignableMemberIds: [], scheduledStart: '', scheduledEnd: '' };
                      const assignableMembers = (cfg.assignableMemberIds || [])
                        .map(id => members.find(m => m.id === id))
                        .filter((m): m is Member => !!m);
                      return (
                        <tr key={t.id} className="border-b border-gray-50">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(t.taskName) }} />
                              <span className="text-xs">{t.taskName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs">{t.plannedCount}</td>
                          <td className="px-3 py-2 text-xs">{fmtNum(t.minutesPerUnit || 0)}分</td>
                          <td className="px-3 py-2 text-xs font-bold text-orange-700">{fmtNum(t.plannedMinutes)}分</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {assignableMembers.length > 0 ? assignableMembers.map((m, idx) => (
                                <span key={m.id} className={`text-[10px] px-1.5 py-0.5 rounded ${idx === 0 ? 'bg-purple-100 text-purple-800 font-bold' : 'bg-green-50 text-green-700'}`}>
                                  {idx + 1}. {m.name}
                                </span>
                              )) : <span className="text-[10px] text-red-400">未設定（日次業務入力で設定してください）</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {(() => {
                              const ranges = (cfg.scheduledRanges && cfg.scheduledRanges.length > 0)
                                ? cfg.scheduledRanges
                                : (cfg.scheduledStart && cfg.scheduledEnd ? [{ start: cfg.scheduledStart, end: cfg.scheduledEnd }] : []);
                              if (ranges.length === 0) return <span className="text-xs text-gray-400">-</span>;
                              return (
                                <div className="flex flex-wrap gap-1">
                                  {ranges.map((r, ri) => (
                                    <span key={ri} className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-700 rounded font-bold">
                                      {r.start}〜{r.end}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Auto-assign button */}
        <div className="flex justify-center">
          <button
            onClick={handleAutoAssign}
            disabled={tasks.length === 0 || activeMembers.length === 0}
            className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-10 py-4 rounded-xl text-lg font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            AI自動割振を実行
          </button>
        </div>

        {/* Warnings */}
        {unassignedWarnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-sm text-yellow-800">
            <strong>注意：</strong>以下のタスクは割り振りできませんでした（対応可能メンバー不足 or リソース不足）：
            <ul className="mt-1 list-disc list-inside">
              {unassignedWarnings.map(w => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Preview Timeline */}
        {previewTimeline && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">割振プレビュー</h3>
              <button
                onClick={handleApplyTimeline}
                disabled={applied}
                className={`px-8 py-3 rounded-xl text-sm font-bold shadow-lg transition-all ${
                  applied
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {applied ? '反映済み' : 'タイムラインに反映'}
              </button>
            </div>

            {/* Per-member summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {memberPreviewSummary.map(ms => (
                <div key={ms.member.id} className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-start">
                    <p className="text-xs font-bold text-gray-700">{ms.member.name}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      ms.member.role === 'employee' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                    }`}>{ms.member.role === 'employee' ? '社員' : 'ＡＴ'}</span>
                  </div>
                  <p className="text-sm font-bold text-gray-800 mt-1">{fmtNum(ms.totalMinutes)}分 / {fmtNum(ms.shiftMinutes)}分</p>
                  <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                    <div
                      className={`h-full rounded-full ${ms.freeMinutes < 0 ? 'bg-red-400' : ms.freeMinutes < 30 ? 'bg-yellow-400' : 'bg-green-400'}`}
                      style={{ width: `${Math.min(100, (ms.totalMinutes / ms.shiftMinutes) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">空き: {fmtNum(ms.freeMinutes)}分</p>
                </div>
              ))}
            </div>

            {/* Timeline visualization */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h4 className="text-sm font-semibold text-gray-600 mb-3">個人別タイムライン</h4>
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
                  const memberBlocks = previewTimeline[m.id] || {};
                  const totalMins = Object.keys(memberBlocks).length * 15;

                  return (
                    <div key={m.id} className="flex items-center mb-1">
                      <div className="w-20 flex-shrink-0 text-xs font-medium text-gray-700 text-right pr-2 truncate">
                        {m.name}
                      </div>
                      <div className="flex flex-1 h-7 bg-gray-50 rounded overflow-hidden border border-gray-100">
                        {Array.from({ length: TOTAL_BLOCKS }, (_, i) => {
                          const inShift = shift ? (() => {
                            const { start, end } = getShiftBlocks(shift);
                            return i >= start && i < end;
                          })() : false;
                          const taskName = memberBlocks[String(i)];
                          const isHourStart = i % BLOCKS_PER_HOUR === 0;

                          return (
                            <div
                              key={i}
                              className={`h-full ${isHourStart ? 'border-l border-gray-200' : 'border-l border-gray-100/50'} ${
                                inShift ? '' : 'opacity-30'
                              }`}
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
                        {fmtNum(totalMins)}分
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Color legend */}
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
                {allTaskNames.map(name => (
                  <span key={name} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-gray-200 bg-gray-50">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(name) }} />
                    {name.replace(/^【[^】]+】/, '')}
                  </span>
                ))}
              </div>
            </div>

            {/* Per-member detailed breakdown */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h4 className="text-sm font-semibold text-gray-600 mb-3">業務内訳（個人別）</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {memberPreviewSummary.map(ms => (
                  <div key={ms.member.id} className="bg-gray-50 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-sm font-bold text-gray-700">{ms.member.name}</p>
                      <p className="text-xs text-gray-500">{fmtNum(ms.totalMinutes)}分 / {fmtNum(ms.shiftMinutes)}分</p>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(ms.taskBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([taskName, mins]) => (
                          <div key={taskName} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                            <span className="flex-1 text-xs text-gray-600 truncate">{taskName}</span>
                            <span className="text-xs font-bold text-gray-700">{fmtNum(mins)}分</span>
                            <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(100, (mins / ms.shiftMinutes) * 100)}%`,
                                  backgroundColor: getTaskColor(taskName),
                                }}
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                    {/* Time breakdown bar */}
                    <div className="mt-3 flex h-4 rounded overflow-hidden border border-gray-200">
                      {Object.entries(ms.taskBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([taskName, mins]) => (
                          <div
                            key={taskName}
                            className="h-full"
                            style={{
                              width: `${(mins / ms.shiftMinutes) * 100}%`,
                              backgroundColor: getTaskColor(taskName),
                            }}
                            title={`${taskName}: ${mins}分`}
                          />
                        ))}
                      {ms.freeMinutes > 0 && (
                        <div className="h-full bg-gray-100" style={{ width: `${(ms.freeMinutes / ms.shiftMinutes) * 100}%` }} title={`空き: ${ms.freeMinutes}分`} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {applied && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800 text-center font-semibold">
                タイムラインに反映しました！日次業務入力ページで確認できます。
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-3">AI自動割振の仕組み</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-600">
            <div className="space-y-2">
              <p><span className="font-bold text-green-700">1.</span> シフト登録済みメンバーの出勤時間を確認</p>
              <p><span className="font-bold text-green-700">2.</span> 全員に休憩を割当（11:30〜13:30の間に1時間）</p>
              <p><span className="font-bold text-green-700">3.</span> 日次業務入力で「実施時間」が設定されたタスクを指定時間に固定配置</p>
              <p><span className="font-bold text-green-700">4.</span> 「対応可能メンバー」の選択順を優先順位として割振</p>
            </div>
            <div className="space-y-2">
              <p><span className="font-bold text-green-700">5.</span> 各タスクの必要時間（必要件数 × 1回あたり時間）に応じて割当</p>
              <p><span className="font-bold text-green-700">6.</span> 同じ優先順位（同列）の場合、空き時間が多いメンバーに割当</p>
              <p><span className="font-bold text-green-700">7.</span> 対応可能メンバーがいない/空きがない場合は割当不可として残ります</p>
            </div>
          </div>
          <div className="mt-3 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-700">
            <strong>ヒント：</strong>精度を上げるには<strong>「日次業務入力」画面の予定入力</strong>で各業務の<strong>対応可能メンバー</strong>（選択順 = 優先順位）と<strong>実施時間</strong>を設定してください。
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
