'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, setDailyTasks, getShifts, getTimelineForDate, setTimelineForDate, getCategoryTaskColor, getTaskAssignments, getBreakSlotsForDate, setBreakSlotForDate, getDefaultBreakSlot, type BreakSlot, DEFAULT_TASKS, TASK_CATEGORIES, fmtNum } from '@/lib/store';
import type { DailyTask, Member, ShiftEntry } from '@/lib/types';

// ===== Timeline Constants =====
const TIMELINE_START = 8; // 8:00
const TIMELINE_END = 22; // 22:00
const BLOCKS_PER_HOUR = 4; // 15-min blocks
const TOTAL_BLOCKS = (TIMELINE_END - TIMELINE_START) * BLOCKS_PER_HOUR; // 56

// Break window: 12:00-14:30 (1 hour break per member)
const BREAK_DURATION_BLOCKS = 4; // 1 hour = 4 blocks (15min each)
const EARLY_BREAK_START_BLOCK = (12 - TIMELINE_START) * BLOCKS_PER_HOUR;   // 16 = 12:00
const LATE_BREAK_START_BLOCK = ((13 - TIMELINE_START) * BLOCKS_PER_HOUR) + 1; // 21 = 13:15
const BREAK_TASK_NAME = '【他】休憩';
// Periodic tasks: should be placed at intervals (not consecutive) — 15 min work every ~45 min
const PERIODIC_TASKS = ['【LINE】LINE整理', '【LINE】要対応'];
const PERIODIC_GAP_BLOCKS = 3; // 3 blocks = 45 min between consecutive placements

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
  minutesPerUnit: number; // default minutes-per-unit from DailyTask, used as fallback speed
}

// Place blocks for a member, respecting "periodic" tasks: leave ~30min gap between consecutive blocks.
// Returns the count of blocks actually placed.
function placeBlocksForMember(
  memberId: string,
  taskName: string,
  count: number,
  availableBlocks: number[],
  timeline: Record<string, Record<string, string>>,
  periodic: boolean,
  inRangeOnly?: { start: number; end: number }
): { placed: number; used: number[] } {
  if (count <= 0 || availableBlocks.length === 0) return { placed: 0, used: [] };
  const filtered = inRangeOnly
    ? availableBlocks.filter(b => b >= inRangeOnly.start && b < inRangeOnly.end)
    : availableBlocks;
  if (filtered.length === 0) return { placed: 0, used: [] };

  const used: number[] = [];
  if (!periodic) {
    // Consecutive placement (default)
    const toAssign = Math.min(count, filtered.length);
    for (let i = 0; i < toAssign; i++) {
      timeline[memberId][String(filtered[i])] = taskName;
      used.push(filtered[i]);
    }
    return { placed: toAssign, used };
  }

  // Periodic: enforce ~PERIODIC_GAP_BLOCKS gap between consecutive placements (by absolute block index)
  let lastPlaced = -PERIODIC_GAP_BLOCKS;
  for (const b of filtered) {
    if (used.length >= count) break;
    if (b - lastPlaced >= PERIODIC_GAP_BLOCKS) {
      timeline[memberId][String(b)] = taskName;
      used.push(b);
      lastPlaced = b;
    }
  }
  return { placed: used.length, used };
}

function runAutoAssignAlgorithm(
  tasks: DailyTask[],
  activeMembers: Member[],
  shifts: ShiftEntry[],
  breakSlotsMap: Record<string, BreakSlot> = {}
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
  // Break window: 12:00-14:30. Per-member slot from breakSlotsMap (fallback: default by name)
  //   - 'early' (12:00-13:00, blocks 16-19)
  //   - 'late'  (13:15-14:15, blocks 21-24)
  //   - 'skip'  (no break — 12:00-14:30 fully available for business)
  const membersWithShifts = activeMembers.filter(m => memberAvailableBlocks[m.id]?.length > 0);

  membersWithShifts.forEach(member => {
    const slot: BreakSlot = breakSlotsMap[member.id] || getDefaultBreakSlot(member.name);
    if (slot === 'skip') return;
    const startBlock = slot === 'early' ? EARLY_BREAK_START_BLOCK : LATE_BREAK_START_BLOCK;
    for (let b = startBlock; b < startBlock + BREAK_DURATION_BLOCKS; b++) {
      if (memberAvailableBlocks[member.id]?.includes(b)) {
        timeline[member.id][String(b)] = BREAK_TASK_NAME;
        memberAvailableBlocks[member.id] = memberAvailableBlocks[member.id].filter(x => x !== b);
      }
    }
  });

  // ===== Read taskAssignments (per-task config from 日次業務入力) =====
  const taskAssignmentsCfg = getTaskAssignments();

  // ===== Step 2: Place tasks with scheduled times (実施時間) — capped at 必要時間 =====
  // BUGFIX: previously this placed all priorityMembers × full window blocks, ignoring
  // task.plannedMinutes. That caused massive over-assignment (e.g. 計算書作成 900分 →
  // 3 members × 480 min = 1440 min assigned). Now we cap at plannedMinutes and distribute
  // by speed-weighted shares within the time window.
  const blocksPlacedInStep2: Record<string, number> = {};
  const processedTaskNamesStep2 = new Set<string>();

  for (const task of tasks) {
    if (task.taskName === BREAK_TASK_NAME) continue;
    if (processedTaskNamesStep2.has(task.taskName)) continue; // dedupe by name (固定+引継ぎが重複時)
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

    processedTaskNamesStep2.add(task.taskName);

    // Total blocks needed (sum across duplicate rows with same taskName)
    const totalPlannedMin = tasks
      .filter(t => t.taskName === task.taskName)
      .reduce((s, t) => s + t.plannedMinutes, 0);
    const blocksNeeded = Math.max(1, Math.ceil(totalPlannedMin / 15));
    let remaining = blocksNeeded;

    const allCapable = (cfg.assignableMemberIds || [])
      .map(id => activeMembers.find(m => m.id === id))
      .filter(Boolean) as Member[];
    if (allCapable.length === 0) continue;

    const N = cfg.assigneeCount && cfg.assigneeCount > 0 ? cfg.assigneeCount : allCapable.length;
    const priorityMembers = allCapable.slice(0, N);

    // Speed-weighted target blocks per member
    const defaultSpeed = (task.minutesPerUnit && task.minutesPerUnit > 0) ? task.minutesPerUnit : 1;
    const weights = priorityMembers.map(m =>
      1 / Math.max((m.speedRatings?.[task.taskName] || defaultSpeed), 0.1)
    );
    const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
    const targets: number[] = priorityMembers.map((_, i) => {
      if (i === priorityMembers.length - 1) return -1;
      return Math.round((weights[i] / totalWeight) * blocksNeeded);
    });
    let allocSum = 0;
    targets.forEach(t => { if (t >= 0) allocSum += t; });
    if (targets.length > 0 && targets[targets.length - 1] === -1) {
      targets[targets.length - 1] = Math.max(0, blocksNeeded - allocSum);
    }

    // Place each member's share within the configured time ranges
    priorityMembers.forEach((member, idx) => {
      if (remaining <= 0) return;
      let memberQuota = Math.min(targets[idx], remaining);
      if (memberQuota <= 0) return;

      for (const range of ranges) {
        if (memberQuota <= 0) break;
        const [startH, startM] = range.start.split(':').map(Number);
        const [endH, endM] = range.end.split(':').map(Number);
        const startBlock = Math.floor(((startH * 60 + startM) - TIMELINE_START * 60) / 15);
        const endBlock = Math.floor(((endH * 60 + endM) - TIMELINE_START * 60) / 15);
        if (startBlock < 0 || endBlock <= startBlock || startBlock >= TOTAL_BLOCKS) continue;

        const inRangeAvail = (memberAvailableBlocks[member.id] || [])
          .filter(b => b >= startBlock && b < Math.min(endBlock, TOTAL_BLOCKS));
        const toAssign = Math.min(memberQuota, inRangeAvail.length);
        for (let i = 0; i < toAssign; i++) {
          timeline[member.id][String(inRangeAvail[i])] = task.taskName;
          memberAvailableBlocks[member.id] = memberAvailableBlocks[member.id].filter(x => x !== inRangeAvail[i]);
        }
        memberQuota -= toAssign;
        remaining -= toAssign;
      }
    });

    blocksPlacedInStep2[task.taskName] = blocksNeeded - remaining;
  }

  // ===== Step 3: Prepare remaining assignable tasks (deduplicated by taskName, subtracting Step 2) =====
  const assignableTasks: AssignableTask[] = [];
  const processedTaskNamesStep3 = new Set<string>();

  for (const task of tasks) {
    if (task.taskName === BREAK_TASK_NAME) continue;
    if (processedTaskNamesStep3.has(task.taskName)) continue;
    processedTaskNamesStep3.add(task.taskName);

    const totalPlannedMin = tasks
      .filter(t => t.taskName === task.taskName)
      .reduce((s, t) => s + t.plannedMinutes, 0);
    const fullNeeded = Math.max(1, Math.ceil(totalPlannedMin / 15));
    const alreadyPlaced = blocksPlacedInStep2[task.taskName] || 0;
    const remainingBlocks = fullNeeded - alreadyPlaced;
    if (remainingBlocks <= 0) continue;

    assignableTasks.push({
      taskName: task.taskName,
      blocksNeeded: remainingBlocks,
      assigneeId: task.assigneeId,
      priority: 0,
      minutesPerUnit: task.minutesPerUnit || 0,
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
    const isPeriodic = PERIODIC_TASKS.includes(task.taskName);

    if (task.assigneeId) {
      const available = memberAvailableBlocks[task.assigneeId] || [];
      const r = placeBlocksForMember(task.assigneeId, task.taskName, remaining, available, timeline, isPeriodic);
      memberAvailableBlocks[task.assigneeId] = available.filter(b => !r.used.includes(b));
      remaining -= r.placed;
    }

    if (remaining <= 0) continue;

    // Find capable members from taskAssignments, ordered by selection (= priority)
    const cfg = taskAssignmentsCfg[task.taskName];
    const assignableIds = cfg?.assignableMemberIds || [];
    const allCapable = assignableIds
      .map(id => activeMembers.find(m => m.id === id))
      .filter((m): m is Member => !!m && m.id !== task.assigneeId);
    // 対応人数: cap the candidate list to top N in priority order
    const N = cfg?.assigneeCount && cfg.assigneeCount > 0 ? cfg.assigneeCount : allCapable.length;
    const effectiveN = task.assigneeId ? Math.max(0, N - 1) : N;
    const topNCapable = allCapable.slice(0, effectiveN);
    const overflowCapable = allCapable.slice(effectiveN);

    // ===== Pass 1: distribute work across top N capable members, weighted by speed =====
    if (topNCapable.length > 0 && remaining > 0) {
      const defaultSpeed = (task.minutesPerUnit && task.minutesPerUnit > 0) ? task.minutesPerUnit : 1;
      const weights = topNCapable.map(m => {
        const s = m.speedRatings?.[task.taskName];
        return 1 / Math.max((s && s > 0) ? s : defaultSpeed, 0.1);
      });
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      const totalRemaining = remaining;
      const targets: number[] = topNCapable.map((_, idx) => {
        if (idx === topNCapable.length - 1) return -1;
        return Math.round((weights[idx] / totalWeight) * totalRemaining);
      });
      let alloc = 0;
      targets.forEach(t => { if (t >= 0) alloc += t; });
      if (targets.length > 0) targets[targets.length - 1] = Math.max(0, totalRemaining - alloc);

      topNCapable.forEach((member, idx) => {
        if (remaining <= 0) return;
        const available = memberAvailableBlocks[member.id] || [];
        const want = Math.min(targets[idx], remaining);
        const r = placeBlocksForMember(member.id, task.taskName, want, available, timeline, isPeriodic);
        memberAvailableBlocks[member.id] = available.filter(b => !r.used.includes(b));
        remaining -= r.placed;
      });
    }

    // ===== Pass 2: expand to OTHER assignable members beyond top N if still remaining =====
    if (remaining > 0) {
      for (const member of overflowCapable) {
        if (remaining <= 0) break;
        const available = memberAvailableBlocks[member.id] || [];
        const r = placeBlocksForMember(member.id, task.taskName, remaining, available, timeline, isPeriodic);
        memberAvailableBlocks[member.id] = available.filter(b => !r.used.includes(b));
        remaining -= r.placed;
      }
    }

    // ===== Pass 3: ONLY if assigneeCount was NOT set, fall back to least-loaded ANY member =====
    const strictCount = cfg?.assigneeCount && cfg.assigneeCount > 0;
    if (remaining > 0 && !strictCount) {
      const sortedByLoad = [...membersWithShifts].sort((a, b) =>
        (memberAvailableBlocks[b.id]?.length || 0) - (memberAvailableBlocks[a.id]?.length || 0)
      );
      for (const member of sortedByLoad) {
        if (remaining <= 0) break;
        if (allCapable.find(c => c.id === member.id)) continue;
        const available = memberAvailableBlocks[member.id] || [];
        const r = placeBlocksForMember(member.id, task.taskName, remaining, available, timeline, isPeriodic);
        memberAvailableBlocks[member.id] = available.filter(b => !r.used.includes(b));
        remaining -= r.placed;
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
  const [breakSlots, setBreakSlotsState] = useState<Record<string, BreakSlot>>({});

  // Load daily tasks for selected date
  useEffect(() => {
    const allTasks = getDailyTasks().filter(t => t.date === date);
    setTasksState(allTasks);
    setPreviewTimeline(null);
    setApplied(false);
    setUnassignedWarnings([]);
    setBreakSlotsState(getBreakSlotsForDate(date));
  }, [date, dataVersion]);

  function setMemberBreakSlot(memberId: string, slot: BreakSlot) {
    const next = { ...breakSlots, [memberId]: slot };
    setBreakSlotsState(next);
    setBreakSlotForDate(date, memberId, slot);
  }
  function effectiveSlot(member: Member): BreakSlot {
    return breakSlots[member.id] || getDefaultBreakSlot(member.name);
  }

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

    const result = runAutoAssignAlgorithm(tasks, activeMembers, shiftsForDate, breakSlots);
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
              日次業務入力画面の予定入力（対応可能メンバー・実施時間・対応人数）から、1日のタイムスケジュールを自動生成します
            </p>
          </div>
          <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">{date}</span>
        </div>

        {/* Data source banner */}
        <div className="bg-purple-50 border-l-4 border-purple-400 rounded-lg px-4 py-3 text-sm text-purple-800">
          🔗 <strong>データ連携：</strong>
          このページは <a href="/daily" className="underline font-semibold">日次業務入力画面</a> で設定した以下の3要素を直接読み込んで割振します：
          <ul className="mt-1 ml-4 list-disc">
            <li><strong>対応可能メンバー</strong>（選択順=優先順位）— 誰が担当できるか</li>
            <li><strong>実施時間</strong> — いつ実施するか（複数時間帯対応）</li>
            <li><strong>対応人数</strong> — その日に何名で担当するか（上位N名のみに割当）</li>
          </ul>
          <p className="mt-1 text-xs text-purple-700">
            ＋ <strong>シフト</strong>から出勤者を抽出。設定変更は日次業務入力画面で行ってください（業務単位のグローバル設定なので、日付を変えても保持されます）。
          </p>
        </div>

        {/* How it works (moved to top per request) */}
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-bold text-gray-700 mb-3">⚙️ AI自動割振の仕組み</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-600">
            <div className="space-y-2">
              <p><span className="font-bold text-green-700">1.</span> シフト登録済みメンバーの出勤時間を確認</p>
              <p><span className="font-bold text-green-700">2.</span> 全員に休憩を割当（<strong>12:00-14:30</strong>の間に1時間: 早12:00/遅13:15）<span className="text-amber-700">※下で個別変更可</span></p>
              <p><span className="font-bold text-green-700">3.</span> 日次業務入力で「実施時間」が設定されたタスクを指定時間に固定配置</p>
              <p><span className="font-bold text-green-700">4.</span> 「対応可能メンバー」の選択順を優先順位として割振</p>
            </div>
            <div className="space-y-2">
              <p><span className="font-bold text-green-700">5.</span> 各タスクの必要時間（必要件数 × 1回あたり時間）に応じて割当</p>
              <p><span className="font-bold text-green-700">6.</span> 「対応人数」で上位N名に絞って分担。GAPが残る場合は対応可能メンバー全員に拡大</p>
              <p><span className="font-bold text-green-700">7.</span> 対応可能メンバーがいない/空きがない場合は割当不可として残ります</p>
            </div>
          </div>

          {/* 条件設定: 休憩スロット選択 */}
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-xs font-bold text-amber-900 mb-2">🍱 条件設定: 休憩時間（本日のみ）</p>
            <p className="text-[11px] text-amber-700 mb-2">
              休憩窓 12:00〜14:30 の中で各メンバーの休憩開始時刻を選択：
              <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold">12:00 (早)</span>
              <span className="ml-1 px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-bold">13:15 (遅)</span>
              <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded font-bold">なし</span>
              （初期値は名前から自動: 潮田/国兼/三原/石井=早、和田/熊谷/鈴木=遅）
            </p>
            {activeMembers.length === 0 ? (
              <p className="text-[11px] text-gray-500">出勤メンバーがいません</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {activeMembers.map(m => {
                  const slot = effectiveSlot(m);
                  return (
                    <div key={m.id} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded px-2 py-1">
                      <span className="text-xs font-medium text-gray-700 flex-1 truncate">{m.name}</span>
                      <select
                        value={slot}
                        onChange={e => setMemberBreakSlot(m.id, e.target.value as BreakSlot)}
                        className={`text-[10px] border rounded px-1 py-0.5 font-bold ${
                          slot === 'early' ? 'bg-blue-50 text-blue-800 border-blue-200' :
                          slot === 'late' ? 'bg-purple-50 text-purple-800 border-purple-200' :
                          'bg-gray-50 text-gray-700 border-gray-300'
                        }`}
                      >
                        <option value="early">12:00 早</option>
                        <option value="late">13:15 遅</option>
                        <option value="skip">なし</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-3 p-3 bg-yellow-50 rounded-lg text-xs text-yellow-700">
            <strong>ヒント：</strong>精度を上げるには<strong>「日次業務入力」画面の予定入力</strong>で各業務の<strong>対応可能メンバー</strong>（選択順 = 優先順位）と<strong>実施時間</strong>を設定してください。
          </div>
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

      </div>
    </DashboardLayout>
  );
}
