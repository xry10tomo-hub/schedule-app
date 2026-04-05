'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, getShippingRecords, getMembers, getToday, exportToCSV, getMemberById, calculateMemberSummary, getDaysInMonth, formatDate } from '@/lib/store';
import type { DailyTask } from '@/lib/types';

export default function AdminPage() {
  const { members, dataVersion } = useAppContext();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [allTasks, setAllTasks] = useState<DailyTask[]>([]);
  const [viewMode, setViewMode] = useState<'daily' | 'monthly' | 'member'>('daily');

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const daysInMonth = getDaysInMonth(year, month);
  const startDate = `${monthStr}-01`;
  const endDate = `${monthStr}-${String(daysInMonth).padStart(2, '0')}`;

  useEffect(() => {
    setAllTasks(getDailyTasks().filter(t => t.date.startsWith(monthStr)));
  }, [monthStr, dataVersion]);

  // Daily aggregation
  const dailyAgg = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayTasks = allTasks.filter(t => t.date === dateStr);
    return {
      date: dateStr,
      day: d,
      taskCount: dayTasks.length,
      completedCount: dayTasks.filter(t => t.status === 'completed').length,
      plannedMinutes: dayTasks.reduce((s, t) => s + t.plannedMinutes, 0),
      actualMinutes: dayTasks.reduce((s, t) => s + t.actualMinutes, 0),
      plannedPoints: dayTasks.reduce((s, t) => s + t.plannedPoints, 0),
      actualPoints: dayTasks.reduce((s, t) => s + t.actualPoints, 0),
    };
  });

  // Member aggregation
  const memberAgg = members.map(m => {
    const summary = calculateMemberSummary(m.id, startDate, endDate);
    return { ...m, ...summary };
  });

  // Task-type aggregation
  const taskTypeAgg: Record<string, { planned: number; actual: number; count: number }> = {};
  allTasks.forEach(t => {
    if (!taskTypeAgg[t.taskName]) taskTypeAgg[t.taskName] = { planned: 0, actual: 0, count: 0 };
    taskTypeAgg[t.taskName].planned += t.plannedMinutes;
    taskTypeAgg[t.taskName].actual += t.actualMinutes;
    taskTypeAgg[t.taskName].count += 1;
  });

  // Monthly totals
  const monthlyTotals = {
    totalTasks: allTasks.length,
    completedTasks: allTasks.filter(t => t.status === 'completed').length,
    totalPlannedHours: (allTasks.reduce((s, t) => s + t.plannedMinutes, 0) / 60).toFixed(1),
    totalActualHours: (allTasks.reduce((s, t) => s + t.actualMinutes, 0) / 60).toFixed(1),
    totalPlannedPoints: allTasks.reduce((s, t) => s + t.plannedPoints, 0),
    totalActualPoints: allTasks.reduce((s, t) => s + t.actualPoints, 0),
  };

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function handleExportMonthlyCSV() {
    const data = dailyAgg.map(d => ({
      日付: d.date,
      タスク数: d.taskCount,
      完了数: d.completedCount,
      予定時間_分: d.plannedMinutes,
      実績時間_分: d.actualMinutes,
      差分_分: d.actualMinutes - d.plannedMinutes,
      予定点数: d.plannedPoints,
      実績点数: d.actualPoints,
    }));
    exportToCSV(data, `monthly_summary_${monthStr}.csv`);
  }

  function handleExportMemberCSV() {
    const data = memberAgg.map(m => ({
      名前: m.name,
      区分: m.role === 'employee' ? '社員' : 'アルバイト',
      タスク数: m.totalTasks,
      完了数: m.completedTasks,
      予定時間_分: m.totalPlannedMinutes,
      実績時間_分: m.totalActualMinutes,
      効率: (m.efficiency * 100).toFixed(0) + '%',
    }));
    exportToCSV(data, `member_summary_${monthStr}.csv`);
  }

  const maxDailyMinutes = Math.max(...dailyAgg.map(d => Math.max(d.plannedMinutes, d.actualMinutes)), 1);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">管理者ダッシュボード</h1>
          <div className="flex items-center gap-2">
            <button onClick={handleExportMonthlyCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-xs font-medium">月次CSV</button>
            <button onClick={handleExportMemberCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-xs font-medium">メンバーCSV</button>
          </div>
        </div>

        {/* Month Nav */}
        <div className="flex items-center justify-center gap-6">
          <button onClick={prevMonth} className="p-2 hover:bg-green-100 rounded-lg transition-colors">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6"/></svg>
          </button>
          <h2 className="text-xl font-bold text-gray-800">{year}年 {month + 1}月</h2>
          <button onClick={nextMonth} className="p-2 hover:bg-green-100 rounded-lg transition-colors">
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6"/></svg>
          </button>
        </div>

        {/* Monthly Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">総タスク数</p>
            <p className="text-2xl font-bold text-green-700">{monthlyTotals.totalTasks}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">完了タスク</p>
            <p className="text-2xl font-bold text-blue-700">{monthlyTotals.completedTasks}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">予定時間合計</p>
            <p className="text-2xl font-bold text-purple-700">{monthlyTotals.totalPlannedHours}h</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">実績時間合計</p>
            <p className="text-2xl font-bold text-orange-700">{monthlyTotals.totalActualHours}h</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">予定点数</p>
            <p className="text-2xl font-bold text-green-700">{monthlyTotals.totalPlannedPoints}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-500">実績点数</p>
            <p className="text-2xl font-bold text-blue-700">{monthlyTotals.totalActualPoints}</p>
          </div>
        </div>

        {/* View Mode Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['daily', 'monthly', 'member'] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === mode ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {mode === 'daily' ? '日別集計' : mode === 'monthly' ? '業務別集計' : 'メンバー別'}
            </button>
          ))}
        </div>

        {/* Daily View */}
        {viewMode === 'daily' && (
          <div className="space-y-4">
            {/* Bar chart */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-600 mb-4">日別 予定 vs 実績 (分)</h3>
              <div className="flex items-end gap-1 h-48 overflow-x-auto">
                {dailyAgg.map(d => (
                  <div key={d.day} className="flex flex-col items-center gap-1 min-w-[24px]">
                    <div className="flex gap-0.5 items-end h-36">
                      <div className="w-2.5 bg-green-300 rounded-t" style={{ height: `${(d.plannedMinutes / maxDailyMinutes) * 100}%` }} />
                      <div className="w-2.5 bg-blue-400 rounded-t" style={{ height: `${(d.actualMinutes / maxDailyMinutes) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400">{d.day}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-300 rounded" />予定</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 rounded" />実績</span>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-green-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">日付</th>
                    <th className="px-4 py-3 font-semibold">タスク</th>
                    <th className="px-4 py-3 font-semibold">完了</th>
                    <th className="px-4 py-3 font-semibold">予定(分)</th>
                    <th className="px-4 py-3 font-semibold">実績(分)</th>
                    <th className="px-4 py-3 font-semibold">差分</th>
                    <th className="px-4 py-3 font-semibold">完了率</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyAgg.filter(d => d.taskCount > 0).map(d => {
                    const gap = d.actualMinutes - d.plannedMinutes;
                    const rate = d.taskCount > 0 ? (d.completedCount / d.taskCount) * 100 : 0;
                    return (
                      <tr key={d.day} className="border-b border-gray-50 hover:bg-green-50/30">
                        <td className="px-4 py-3 font-medium">{d.date}</td>
                        <td className="px-4 py-3">{d.taskCount}</td>
                        <td className="px-4 py-3">{d.completedCount}</td>
                        <td className="px-4 py-3">{d.plannedMinutes}</td>
                        <td className="px-4 py-3">{d.actualMinutes}</td>
                        <td className={`px-4 py-3 font-semibold ${gap > 0 ? 'text-red-500' : gap < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                          {gap > 0 ? '+' : ''}{gap}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-gray-100 rounded-full h-2">
                              <div className="bg-green-500 h-full rounded-full" style={{ width: `${rate}%` }} />
                            </div>
                            <span className="text-xs">{Math.round(rate)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Task Type View */}
        {viewMode === 'monthly' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-green-50">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">業務名</th>
                  <th className="px-4 py-3 font-semibold">件数</th>
                  <th className="px-4 py-3 font-semibold">予定時間(分)</th>
                  <th className="px-4 py-3 font-semibold">実績時間(分)</th>
                  <th className="px-4 py-3 font-semibold">差分</th>
                  <th className="px-4 py-3 font-semibold">工数比率</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(taskTypeAgg).map(([name, data]) => {
                  const gap = data.actual - data.planned;
                  const totalActual = allTasks.reduce((s, t) => s + t.actualMinutes, 0);
                  const ratio = totalActual > 0 ? (data.actual / totalActual) * 100 : 0;
                  return (
                    <tr key={name} className="border-b border-gray-50 hover:bg-green-50/30">
                      <td className="px-4 py-3 font-medium">{name}</td>
                      <td className="px-4 py-3">{data.count}</td>
                      <td className="px-4 py-3">{data.planned}</td>
                      <td className="px-4 py-3">{data.actual}</td>
                      <td className={`px-4 py-3 font-semibold ${gap > 0 ? 'text-red-500' : gap < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                        {gap > 0 ? '+' : ''}{gap}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-100 rounded-full h-2">
                            <div className="bg-purple-500 h-full rounded-full" style={{ width: `${ratio}%` }} />
                          </div>
                          <span className="text-xs">{ratio.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Member View */}
        {viewMode === 'member' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {memberAgg.filter(m => m.totalTasks > 0).map(m => {
                const gap = m.totalActualMinutes - m.totalPlannedMinutes;
                return (
                  <div key={m.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${
                          m.role === 'employee' ? 'bg-green-600' : 'bg-blue-600'
                        }`}>{m.name.charAt(0)}</div>
                        <div>
                          <h4 className="font-bold text-gray-800">{m.name}</h4>
                          <span className="text-xs text-gray-400">{m.role === 'employee' ? '社員' : 'アルバイト'}</span>
                        </div>
                      </div>
                      <span className={`text-sm font-bold ${gap > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {gap > 0 ? '+' : ''}{gap}分
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-gray-500">タスク数:</span> <span className="font-semibold">{m.totalTasks}</span></div>
                      <div><span className="text-gray-500">完了:</span> <span className="font-semibold">{m.completedTasks}</span></div>
                      <div><span className="text-gray-500">予定:</span> <span className="font-semibold">{m.totalPlannedMinutes}分</span></div>
                      <div><span className="text-gray-500">実績:</span> <span className="font-semibold">{m.totalActualMinutes}分</span></div>
                    </div>
                    <div className="mt-3">
                      <div className="bg-gray-100 rounded-full h-2">
                        <div className="bg-green-500 h-full rounded-full animate-progress" style={{ width: `${m.totalTasks > 0 ? (m.completedTasks / m.totalTasks) * 100 : 0}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">完了率: {m.totalTasks > 0 ? Math.round((m.completedTasks / m.totalTasks) * 100) : 0}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {memberAgg.filter(m => m.totalTasks > 0).length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">この月のデータはありません</p>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
