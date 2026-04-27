'use client';

import { useState, useEffect, useMemo } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, getActualPerformanceAll, getActualTimelineBlocks, getDaysInMonth, exportToCSV, getCategoryTaskColor, getFixedTasks } from '@/lib/store';
import type { DailyTask } from '@/lib/types';

type Metric = 'minutes' | 'count' | 'points' | 'speed';
const METRIC_LABELS: Record<Metric, string> = {
  minutes: '実績時間（分）',
  count: '件数',
  points: '点数',
  speed: '平均スピード',
};
const METRIC_ORDER: Metric[] = ['minutes', 'count', 'points', 'speed'];
const METRIC_BG: Record<Metric, string> = {
  minutes: 'bg-blue-50/50',
  count: 'bg-purple-50/50',
  points: 'bg-pink-50/50',
  speed: 'bg-emerald-50/50',
};
const METRIC_TEXT: Record<Metric, string> = {
  minutes: 'text-blue-700',
  count: 'text-purple-700',
  points: 'text-pink-700',
  speed: 'text-emerald-700',
};

// Tasks where speed should be calculated per-point
const POINTS_BASED_SPEED_TASKS = ['【LINE】画像査定', '【査定】計算書作成', '【営業】商材追い電話'];

export default function AdminPage() {
  const { members, dataVersion } = useAppContext();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [showAllTasks, setShowAllTasks] = useState(false);

  // Priority tasks - shown by default in 集計
  const PRIORITY_TASKS = [
    '【LINE】画像査定',
    '【査定】計算書作成',
    '【査定】計算書提出',
    '【営業】商材追い電話',
    '【営業】受け電話',
    '【査定】計算書（下書き）',
    '【査定】両日提出',
    '【補助】郵送物開封',
  ];
  const [allTasks, setAllTasks] = useState<DailyTask[]>([]);

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const daysInMonth = getDaysInMonth(year, month);

  useEffect(() => {
    setAllTasks(getDailyTasks().filter(t => t.date.startsWith(monthStr)));
  }, [monthStr, dataVersion]);

  // All actual performance and timeline data, filtered to month
  const monthData = useMemo(() => {
    const allActualTl = getActualTimelineBlocks(); // date → memberId → blockIdx → taskName
    const allPerf = getActualPerformanceAll(); // date → memberId → taskName → {count, points}
    return { allActualTl, allPerf };
  }, [dataVersion]);

  // Compute matrix: row=taskName, col=day(1..daysInMonth), value=metric
  // Filtered by selectedMemberId (or all members if empty)
  const matrix = useMemo(() => {
    const taskNamesSet = new Set<string>();
    // Collect task names
    allTasks.forEach(t => taskNamesSet.add(t.taskName));
    Object.values(monthData.allActualTl).forEach(dateData => {
      Object.values(dateData).forEach(memberBlocks => {
        Object.values(memberBlocks).forEach(tn => taskNamesSet.add(tn));
      });
    });
    Object.values(monthData.allPerf).forEach(dateData => {
      Object.values(dateData).forEach(taskPerfs => {
        Object.entries(taskPerfs).forEach(([tn, entry]) => {
          if ((entry.count || 0) > 0 || (entry.points || 0) > 0) taskNamesSet.add(tn);
        });
      });
    });
    // Sort: priority tasks first (in PRIORITY_TASKS order), then 固定業務 order, then alphabetical
    const fixedTasks = getFixedTasks();
    const priorityIdx = (n: string) => {
      const pi = PRIORITY_TASKS.indexOf(n);
      if (pi >= 0) return pi;
      const fi = fixedTasks.indexOf(n);
      if (fi >= 0) return PRIORITY_TASKS.length + fi;
      return PRIORITY_TASKS.length + fixedTasks.length + 1000;
    };
    let taskNames = Array.from(taskNamesSet).sort((a, b) => {
      const da = priorityIdx(a), db = priorityIdx(b);
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });
    // Filter to priority tasks only unless "show all" toggled
    if (!showAllTasks) {
      taskNames = taskNames.filter(n => PRIORITY_TASKS.includes(n));
    }

    // For each task and each day, compute the value
    const data: Record<string, Record<number, { minutes: number; count: number; points: number }>> = {};
    for (const tn of taskNames) {
      data[tn] = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
        let minutes = 0, count = 0, points = 0;
        // Sum minutes from actual timeline
        const dateActualTl = monthData.allActualTl[dateStr] || {};
        Object.entries(dateActualTl).forEach(([memberId, blocks]) => {
          if (selectedMemberId && memberId !== selectedMemberId) return;
          Object.values(blocks).forEach(blockTaskName => {
            if (blockTaskName === tn) minutes += 15;
          });
        });
        // Sum count/points from performance
        const datePerf = monthData.allPerf[dateStr] || {};
        Object.entries(datePerf).forEach(([memberId, taskPerfs]) => {
          if (selectedMemberId && memberId !== selectedMemberId) return;
          const entry = taskPerfs[tn];
          if (entry) {
            count += entry.count || 0;
            points += entry.points || 0;
          }
        });
        data[tn][d] = { minutes, count, points };
      }
    }
    return { taskNames, data };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasks, monthData, daysInMonth, monthStr, selectedMemberId, showAllTasks]);

  function formatCellByMetric(taskName: string, d: number, m: Metric): string {
    const cell = matrix.data[taskName]?.[d] || { minutes: 0, count: 0, points: 0 };
    if (m === 'minutes') return cell.minutes > 0 ? `${cell.minutes}` : '';
    if (m === 'count') return cell.count > 0 ? `${cell.count}` : '';
    if (m === 'points') return cell.points > 0 ? `${cell.points}` : '';
    // speed
    const usePoint = POINTS_BASED_SPEED_TASKS.includes(taskName);
    const denom = usePoint ? cell.points : cell.count;
    if (denom > 0 && cell.minutes > 0) {
      return `${Math.round((cell.minutes / denom) * 10) / 10}`;
    }
    return '';
  }

  function rowTotal(taskName: string): { minutes: number; count: number; points: number; speed: string } {
    let mins = 0, cnt = 0, pts = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const c = matrix.data[taskName]?.[d] || { minutes: 0, count: 0, points: 0 };
      mins += c.minutes; cnt += c.count; pts += c.points;
    }
    const usePoint = POINTS_BASED_SPEED_TASKS.includes(taskName);
    const denom = usePoint ? pts : cnt;
    const speed = denom > 0 && mins > 0 ? `${Math.round((mins / denom) * 10) / 10}` : '';
    return { minutes: mins, count: cnt, points: pts, speed };
  }

  function colTotal(d: number): { minutes: number; count: number; points: number } {
    let mins = 0, cnt = 0, pts = 0;
    for (const tn of matrix.taskNames) {
      const c = matrix.data[tn]?.[d] || { minutes: 0, count: 0, points: 0 };
      mins += c.minutes; cnt += c.count; pts += c.points;
    }
    return { minutes: mins, count: cnt, points: pts };
  }

  const grandTotal = useMemo(() => {
    let mins = 0, cnt = 0, pts = 0;
    matrix.taskNames.forEach(tn => {
      const r = rowTotal(tn);
      mins += r.minutes; cnt += r.count; pts += r.points;
    });
    return { minutes: mins, count: cnt, points: pts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix]);

  // ===== Per-member performance summary (for visual indicators) =====
  const memberPerformance = useMemo(() => {
    return members.map(m => {
      let totalMinutes = 0, totalCount = 0, totalPoints = 0;
      // sum from actual timeline
      Object.values(monthData.allActualTl).forEach(dateData => {
        const memberBlocks = dateData[m.id] || {};
        totalMinutes += Object.keys(memberBlocks).length * 15;
      });
      // sum from performance
      Object.values(monthData.allPerf).forEach(dateData => {
        const taskPerfs = dateData[m.id] || {};
        Object.values(taskPerfs).forEach(entry => {
          totalCount += entry.count || 0;
          totalPoints += entry.points || 0;
        });
      });
      return { id: m.id, name: m.name, role: m.role, totalMinutes, totalCount, totalPoints };
    });
  }, [members, monthData]);

  const maxMinutes = Math.max(1, ...memberPerformance.map(p => p.totalMinutes));
  const maxPoints = Math.max(1, ...memberPerformance.map(p => p.totalPoints));

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function handleExport() {
    const rows: Record<string, unknown>[] = [];
    matrix.taskNames.forEach(tn => {
      METRIC_ORDER.forEach(m => {
        const row: Record<string, unknown> = { 業務名: tn, 指標: METRIC_LABELS[m] };
        for (let d = 1; d <= daysInMonth; d++) {
          row[`${d}日`] = formatCellByMetric(tn, d, m);
        }
        const rt = rowTotal(tn);
        const totalVal = m === 'minutes' ? rt.minutes : m === 'count' ? rt.count : m === 'points' ? rt.points : rt.speed;
        row['合計'] = totalVal;
        rows.push(row);
      });
    });
    exportToCSV(rows, `集計_${monthStr}.csv`);
  }

  // CSV: 商材追い電話 - per-member 実施時間/件数/平均スピード (per-day breakdown)
  function handleExportSalesCall() {
    const TARGET_TASK = '【営業】商材追い電話';
    const rows: Record<string, unknown>[] = [];
    members.forEach(m => {
      // Per-day data
      let totalMin = 0, totalCnt = 0, totalPts = 0;
      const dailyData: { date: string; min: number; cnt: number; pts: number }[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
        // Minutes from actual timeline for this member
        let mins = 0;
        const blocks = monthData.allActualTl[dateStr]?.[m.id] || {};
        Object.values(blocks).forEach(tn => { if (tn === TARGET_TASK) mins += 15; });
        // Count/points from performance for this member
        const entry = monthData.allPerf[dateStr]?.[m.id]?.[TARGET_TASK];
        const cnt = entry?.count || 0;
        const pts = entry?.points || 0;
        if (mins > 0 || cnt > 0 || pts > 0) {
          dailyData.push({ date: dateStr, min: mins, cnt, pts });
        }
        totalMin += mins; totalCnt += cnt; totalPts += pts;
      }
      if (totalMin === 0 && totalCnt === 0 && totalPts === 0) return;
      // Per-day rows
      dailyData.forEach(dd => {
        const denom = dd.pts; // 商材追い電話 is points-based
        const speed = denom > 0 && dd.min > 0 ? Math.round((dd.min / denom) * 10) / 10 : '';
        rows.push({
          日付: dd.date,
          担当者: m.name,
          業務名: TARGET_TASK,
          実施時間_分: dd.min,
          件数: dd.cnt,
          点数: dd.pts,
          平均スピード: speed !== '' ? `${speed}分/点` : '',
        });
      });
      // Monthly total row
      const totalSpeed = totalPts > 0 && totalMin > 0 ? Math.round((totalMin / totalPts) * 10) / 10 : '';
      rows.push({
        日付: `${monthStr} 合計`,
        担当者: m.name,
        業務名: TARGET_TASK,
        実施時間_分: totalMin,
        件数: totalCnt,
        点数: totalPts,
        平均スピード: totalSpeed !== '' ? `${totalSpeed}分/点` : '',
      });
    });
    if (rows.length === 0) {
      alert('この月の【営業】商材追い電話の実績データがありません。');
      return;
    }
    exportToCSV(rows, `商材追い電話_${monthStr}.csv`);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">📊 集計</h1>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium">CSV出力</button>
            <button onClick={handleExportSalesCall} className="bg-orange-50 border border-orange-300 hover:bg-orange-100 text-orange-700 px-4 py-2 rounded-lg text-sm font-medium">📞 商材追い電話CSV</button>
          </div>
        </div>

        {/* Month nav + filters */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">‹</button>
            <span className="text-lg font-bold text-gray-800">{year}年 {month + 1}月</span>
            <button onClick={nextMonth} className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">›</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">対象:</label>
            <select value={selectedMemberId} onChange={e => setSelectedMemberId(e.target.value)} className="border rounded-lg px-3 py-1.5 text-xs">
              <option value="">全員</option>
              <optgroup label="社員">
                {members.filter(m => m.role === 'employee').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
              <optgroup label="アルバイト">
                {members.filter(m => m.role === 'parttime').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={showAllTasks} onChange={e => setShowAllTasks(e.target.checked)} className="accent-green-600" />
            <span className="text-gray-600">{showAllTasks ? 'すべての業務を表示中' : '優先業務のみ表示'}</span>
          </label>
        </div>

        {/* Total summary cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-xs text-blue-600 font-bold">月間 実績時間</p>
            <p className="text-2xl font-bold text-blue-700">{grandTotal.minutes}<span className="text-sm">分</span> <span className="text-xs text-blue-500">({(grandTotal.minutes / 60).toFixed(1)}h)</span></p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <p className="text-xs text-purple-600 font-bold">月間 件数</p>
            <p className="text-2xl font-bold text-purple-700">{grandTotal.count}<span className="text-sm">件</span></p>
          </div>
          <div className="bg-pink-50 border border-pink-200 rounded-xl p-4">
            <p className="text-xs text-pink-600 font-bold">月間 点数</p>
            <p className="text-2xl font-bold text-pink-700">{grandTotal.points}<span className="text-sm">点</span></p>
          </div>
        </div>

        {/* Matrix table: row=task×metric, col=day (4 sub-rows per task) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">業務 × 日別 マトリックス（4指標同時表示）</h3>
          <div className="overflow-x-auto max-h-[75vh] overflow-y-auto">
            <table className="text-[11px] border-collapse">
              <thead className="sticky top-0 bg-white z-20">
                <tr>
                  <th className="sticky left-0 bg-gray-100 border border-gray-200 px-2 py-1 text-left min-w-[140px] z-30">業務名</th>
                  <th className="sticky left-[140px] bg-gray-100 border border-gray-200 px-2 py-1 text-left min-w-[90px] z-30">指標</th>
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                    const dow = new Date(year, month, d).getDay();
                    return (
                      <th key={d} className={`border border-gray-200 px-1 py-1 min-w-[36px] text-center ${
                        dow === 0 ? 'bg-red-50 text-red-600' : dow === 6 ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-600'
                      }`}>{d}</th>
                    );
                  })}
                  <th className="sticky right-0 bg-amber-100 border border-amber-300 px-2 py-1 text-center min-w-[60px] font-bold z-30">合計</th>
                </tr>
              </thead>
              <tbody>
                {matrix.taskNames.map(tn => {
                  const rt = rowTotal(tn);
                  return METRIC_ORDER.map((m, idx) => {
                    const totalDisplay = m === 'minutes' ? rt.minutes : m === 'count' ? rt.count : m === 'points' ? rt.points : rt.speed;
                    return (
                      <tr key={`${tn}-${m}`} className={`hover:bg-gray-50 ${METRIC_BG[m]} ${idx === 0 ? 'border-t-2 border-t-gray-300' : ''}`}>
                        {idx === 0 ? (
                          <td rowSpan={4} className="sticky left-0 bg-white border border-gray-200 px-2 py-1 z-10 align-top">
                            <div className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: getCategoryTaskColor(tn) }} />
                              <span className="text-gray-700 text-[10px] font-semibold" title={tn}>{tn}</span>
                            </div>
                          </td>
                        ) : null}
                        <td className={`sticky left-[140px] border border-gray-200 px-2 py-1 text-[10px] font-semibold z-10 ${METRIC_BG[m]} ${METRIC_TEXT[m]}`}>
                          {METRIC_LABELS[m]}
                        </td>
                        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                          const v = formatCellByMetric(tn, d, m);
                          return (
                            <td key={d} className={`border border-gray-100 px-1 py-1 text-center ${METRIC_TEXT[m]}`}>{v}</td>
                          );
                        })}
                        <td className={`sticky right-0 border border-amber-200 px-2 py-1 text-center font-bold ${METRIC_BG[m]} ${METRIC_TEXT[m]}`}>
                          {totalDisplay || ''}
                        </td>
                      </tr>
                    );
                  });
                })}
                {/* Day totals (3 metric rows, no speed total) */}
                {(['minutes', 'count', 'points'] as Metric[]).map((m, idx) => (
                  <tr key={`total-${m}`} className={`bg-gray-100 font-bold ${idx === 0 ? 'border-t-2 border-t-gray-400' : ''}`}>
                    {idx === 0 ? (
                      <td rowSpan={3} className="sticky left-0 bg-gray-200 border border-gray-300 px-2 py-1 z-10 align-top">日別合計</td>
                    ) : null}
                    <td className={`sticky left-[140px] bg-gray-100 border border-gray-300 px-2 py-1 text-[10px] z-10 ${METRIC_TEXT[m]}`}>
                      {METRIC_LABELS[m]}
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                      const ct = colTotal(d);
                      const val = m === 'minutes' ? ct.minutes : m === 'count' ? ct.count : ct.points;
                      return (
                        <td key={d} className="border border-gray-200 px-1 py-1 text-center text-gray-800">{val || ''}</td>
                      );
                    })}
                    <td className="sticky right-0 bg-amber-200 border border-amber-400 px-2 py-1 text-center font-bold text-amber-900">
                      {m === 'minutes' ? grandTotal.minutes : m === 'count' ? grandTotal.count : grandTotal.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-member performance indicators (visual) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-bold text-gray-700 mb-4">📈 個人別パフォーマンス指標（{year}年{month + 1}月）</h3>
          <div className="space-y-3">
            {memberPerformance
              .filter(p => p.totalMinutes > 0 || p.totalCount > 0 || p.totalPoints > 0)
              .sort((a, b) => b.totalMinutes - a.totalMinutes)
              .map(p => {
                const minRate = (p.totalMinutes / maxMinutes) * 100;
                const ptRate = (p.totalPoints / maxPoints) * 100;
                const isEmployee = p.role === 'employee';
                return (
                  <div key={p.id} className="border border-gray-100 rounded-lg p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${isEmployee ? 'bg-green-500' : 'bg-blue-500'}`} />
                        <span className="text-sm font-bold text-gray-800">{p.name}</span>
                        <span className="text-[10px] text-gray-400">({isEmployee ? '社員' : 'アルバイト'})</span>
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-blue-700"><b>{p.totalMinutes}</b>分 ({(p.totalMinutes/60).toFixed(1)}h)</span>
                        <span className="text-purple-700"><b>{p.totalCount}</b>件</span>
                        <span className="text-pink-700"><b>{p.totalPoints}</b>点</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-16">実績時間</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all" style={{ width: `${minRate}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-500 w-10 text-right">{Math.round(minRate)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 w-16">点数</span>
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-pink-400 to-pink-600 transition-all" style={{ width: `${ptRate}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-500 w-10 text-right">{Math.round(ptRate)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })
            }
            {memberPerformance.every(p => p.totalMinutes === 0 && p.totalCount === 0 && p.totalPoints === 0) && (
              <p className="text-xs text-gray-400 text-center py-6">この月の実績データがありません。</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
