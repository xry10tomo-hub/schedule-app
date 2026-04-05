'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, getShippingRecords, getShifts, getToday, getTimelineForDate, calculateDailySummary } from '@/lib/store';
import type { DailyTask, ShippingRecord } from '@/lib/types';

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

// Task colors (same as daily page)
const TASK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
  '#e11d48', '#84cc16', '#0ea5e9', '#d946ef', '#fbbf24',
  '#22c55e', '#a855f7', '#fb7185', '#2dd4bf', '#facc15',
  '#78716c', '#64748b', '#0d9488', '#db2777', '#ea580c',
  '#4f46e5', '#059669', '#dc2626', '#7c3aed', '#ca8a04',
];

export default function HomePage() {
  const { currentUserId, members, dataVersion } = useAppContext();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [shippingRecords, setShippingRecordsState] = useState<ShippingRecord[]>([]);
  const [myTimelineTasks, setMyTimelineTasks] = useState<Record<string, number>>({});
  const [myTimelineTotal, setMyTimelineTotal] = useState(0);
  const today = getToday();
  const currentMember = members.find(m => m.id === currentUserId);

  useEffect(() => {
    const allTasks = getDailyTasks().filter(t => t.date === today);
    setTasks(allTasks);
    setShippingRecordsState(getShippingRecords().filter(r => r.date === today));

    // Load timeline data for current user
    const timelineData = getTimelineForDate(today);
    const myBlocks = timelineData[currentUserId] || {};
    const taskBreakdown: Record<string, number> = {};
    Object.values(myBlocks).forEach(taskName => {
      taskBreakdown[taskName] = (taskBreakdown[taskName] || 0) + 15;
    });
    setMyTimelineTasks(taskBreakdown);
    setMyTimelineTotal(Object.keys(myBlocks).length * 15);
  }, [today, dataVersion, currentUserId]);

  const summary = calculateDailySummary(today);
  const myTasks = tasks.filter(t => t.assigneeId === currentUserId);
  const myCompleted = myTasks.filter(t => t.status === 'completed').length;
  const myProgress = myTasks.length > 0 ? (myCompleted / myTasks.length) * 100 : 0;

  const totalShippingPoints = shippingRecords.reduce((s, r) => s + r.points, 0);
  const totalShippingItems = shippingRecords.reduce((s, r) => s + r.itemCount, 0);

  // My actual totals
  const myActualMinutes = myTasks.reduce((s, t) => s + t.actualMinutes, 0);
  const myActualCount = myTasks.reduce((s, t) => s + t.actualCount, 0);

  // Shift for current user
  const shifts = getShifts().filter(s => s.date === today && s.memberId === currentUserId);
  const myShiftMinutes = shifts.reduce((sum, s) => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    return sum + (eh * 60 + em - sh * 60 - sm);
  }, 0);

  // All unique task names for color mapping
  const allTaskNames = Array.from(new Set([
    ...tasks.map(t => t.taskName),
    ...Object.keys(myTimelineTasks),
  ])).sort();

  function getTaskColor(taskName: string): string {
    const idx = allTaskNames.indexOf(taskName);
    return idx >= 0 ? TASK_COLORS[idx % TASK_COLORS.length] : '#9ca3af';
  }

  // Per-member task summary for the chart
  const memberTaskCounts = members.map(m => {
    const memberTasks = tasks.filter(t => t.assigneeId === m.id);
    const completed = memberTasks.filter(t => t.status === 'completed').length;
    return { name: m.name, total: memberTasks.length, completed };
  }).filter(m => m.total > 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              おはようございます、{currentMember?.name || 'ゲスト'}さん
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
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

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="本日の到着件数" value={totalShippingItems} sub="件" color="blue" />
          <StatCard title="本日の到着点数" value={totalShippingPoints} sub="点" color="purple" />
          <StatCard title="チーム全体タスク" value={summary.taskCount} sub={`完了: ${summary.completedCount}`} color="green" />
          <StatCard title="予実差分" value={`${summary.gapMinutes >= 0 ? '+' : ''}${summary.gapMinutes}分`} sub="実績 - 予定" color="orange" />
        </div>

        {/* Progress Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* My Progress */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">自分の進捗</h3>
            <ProgressRing percent={myProgress} />
            <p className="mt-3 text-sm text-gray-500">{myCompleted} / {myTasks.length} タスク完了</p>
          </div>

          {/* My Resource Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">自分のリソース</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">シフト時間</span>
                <span className="text-sm font-bold text-gray-700">{myShiftMinutes}分 ({(myShiftMinutes / 60).toFixed(1)}h)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-green-600">予定時間（タイムライン）</span>
                <span className="text-sm font-bold text-green-700">{myTimelineTotal}分</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-blue-600">実績時間</span>
                <span className="text-sm font-bold text-blue-700">{myActualMinutes}分</span>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-xs text-gray-500">残り</span>
                <span className={`text-sm font-bold ${(myShiftMinutes - myTimelineTotal) >= 0 ? 'text-gray-600' : 'text-red-600'}`}>
                  {myShiftMinutes - myTimelineTotal}分
                </span>
              </div>
            </div>
          </div>

          {/* Team Progress */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">チーム全体の進捗</h3>
            <ProgressRing percent={summary.completionRate} color="#059669" />
            <p className="mt-3 text-sm text-gray-500">{summary.completedCount} / {summary.taskCount} タスク完了</p>
          </div>
        </div>

        {/* My Today's Timeline Tasks */}
        {Object.keys(myTimelineTasks).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">本日の予定（タイムライン）</h3>
            <div className="space-y-2">
              {Object.entries(myTimelineTasks).sort((a, b) => b[1] - a[1]).map(([taskName, mins]) => (
                <div key={taskName} className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(taskName) }} />
                  <span className="text-sm text-gray-700 flex-1">{taskName}</span>
                  <span className="text-sm font-bold text-gray-800">{mins}分</span>
                  <div className="w-32 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min((mins / myShiftMinutes) * 100, 100)}%`,
                        backgroundColor: getTaskColor(taskName),
                      }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-100 mt-2">
                <span className="w-3 h-3" />
                <span className="text-sm font-bold text-gray-700 flex-1">合計</span>
                <span className="text-sm font-bold text-green-700">{myTimelineTotal}分</span>
                <div className="w-32" />
              </div>
            </div>
          </div>
        )}

        {/* My Today's Tasks (from daily task list) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-4">本日の自分のタスク</h3>
          {myTasks.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">本日のタスクはまだ割り当てられていません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2 font-medium">業務名</th>
                    <th className="pb-2 font-medium">予定時間</th>
                    <th className="pb-2 font-medium">実績件数</th>
                    <th className="pb-2 font-medium">実績時間</th>
                    <th className="pb-2 font-medium">差分</th>
                    <th className="pb-2 font-medium">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {myTasks.map(t => {
                    const gap = t.actualMinutes - t.plannedMinutes;
                    return (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-green-50/50">
                        <td className="py-2 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: getTaskColor(t.taskName) }} />
                            {t.taskName}
                          </div>
                        </td>
                        <td className="py-2 text-gray-600">{t.plannedMinutes}分</td>
                        <td className="py-2 text-gray-600">{t.actualCount}件</td>
                        <td className="py-2 text-gray-600">{t.actualMinutes}分</td>
                        <td className={`py-2 font-semibold ${gap > 0 ? 'text-red-500' : gap < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                          {gap > 0 ? '+' : ''}{gap}分
                        </td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.status === 'completed' ? 'bg-green-100 text-green-700' :
                            t.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {t.status === 'completed' ? '完了' : t.status === 'in_progress' ? '進行中' : '未着手'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Member bar chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-600 mb-4">メンバー別タスク進捗</h3>
          {memberTaskCounts.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">本日のタスクはまだありません</p>
          ) : (
            <div className="space-y-3">
              {memberTaskCounts.map(m => {
                const pct = m.total > 0 ? (m.completed / m.total) * 100 : 0;
                return (
                  <div key={m.name} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700 w-16 text-right">{m.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full animate-progress"
                        style={{ width: `${pct}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-gray-700">
                        {m.completed}/{m.total}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500 w-12 text-right">{Math.round(pct)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
