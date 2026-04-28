'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShippingRecords, setShippingRecords, getDailyTasks, getActualPerformanceForDate, setActualPerformanceForDate, generateId, exportToCSV, fmtNum } from '@/lib/store';
import type { ActualPerformanceEntry } from '@/lib/store';
import type { ShippingRecord } from '@/lib/types';

const CARRIERS = ['郵便局（AM）', 'ヤマト（AM）', '佐川（AM）', '郵便局（PM）', 'ヤマト（PM）', '佐川（PM）'];
const DAY_TYPES = ['当日', '両日'] as const;

// Carrier color map (背景塗りつぶし)
const CARRIER_COLOR: Record<string, string> = {
  '郵便局（AM）': 'bg-red-500 text-white font-bold',
  '佐川（AM）': 'bg-blue-500 text-white font-bold',
  'ヤマト（AM）': 'bg-green-500 text-white font-bold',
  '郵便局（PM）': 'bg-red-200 text-red-900 font-bold',
  '佐川（PM）': 'bg-blue-200 text-blue-900 font-bold',
  'ヤマト（PM）': 'bg-green-200 text-green-900 font-bold',
};

export default function ShippingPage() {
  const { members, dataVersion, selectedDate } = useAppContext();
  const [records, setRecordsState] = useState<ShippingRecord[]>([]);

  const loadRecords = useCallback(() => {
    setRecordsState(getShippingRecords().filter(r => r.date === selectedDate));
  }, [selectedDate, dataVersion]);

  // Carry over unfinished records (creator empty) from previous day to today
  // - Only carries records that are NOT themselves carried-over (carriedOver !== true)
  // - Marks copied records as carriedOver: true to prevent chain carryover
  // - One-time cleanup: marks all existing unfinished records as carriedOver to stop current chain
  const carriedOverRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (carriedOverRef.current.has(selectedDate)) return;

    const all = getShippingRecords();

    // ========== One-time cleanup: stop the current carryover chain ==========
    // Mark all existing records (empty creator, no carriedOver flag) as carriedOver: true
    const cleanupFlagKey = 'schedule_shipping_chain_cleanup_v1';
    const cleanupDone = localStorage.getItem(cleanupFlagKey) === 'true';
    let workingAll = all;
    if (!cleanupDone) {
      const cleaned = all.map(r => {
        if (!r.creator && r.carriedOver === undefined) {
          return { ...r, carriedOver: true };
        }
        return r;
      });
      setShippingRecords(cleaned);
      workingAll = cleaned;
      localStorage.setItem(cleanupFlagKey, 'true');
    }

    // ========== Persistent per-date flag ==========
    const flagKey = 'schedule_shipping_carryover_done';
    let processed: string[] = [];
    try { processed = JSON.parse(localStorage.getItem(flagKey) || '[]'); } catch { processed = []; }
    if (processed.includes(selectedDate)) {
      carriedOverRef.current.add(selectedDate);
      if (!cleanupDone) loadRecords();
      return;
    }

    // Calculate previous day
    const prev = new Date(selectedDate + 'T00:00:00');
    prev.setDate(prev.getDate() - 1);
    const prevDateStr = prev.toLocaleDateString('en-CA');

    // Only carry records that:
    // - are on the previous day
    // - have empty creator (unfinished)
    // - are NOT themselves carried-over (carriedOver !== true)
    const unfinishedPrev = workingAll.filter(r =>
      r.date === prevDateStr && !r.creator && r.carriedOver !== true
    );

    if (unfinishedPrev.length > 0) {
      const todayRecords = workingAll.filter(r => r.date === selectedDate);
      const toCarry: ShippingRecord[] = [];
      for (const r of unfinishedPrev) {
        const dup = todayRecords.find(t => t.carrier === r.carrier && t.points === r.points && (t.dayType || '当日') === (r.dayType || '当日') && !t.creator);
        if (!dup) {
          toCarry.push({
            ...r,
            id: generateId(),
            date: selectedDate,
            createdAt: new Date().toISOString(),
            carriedOver: true, // Mark copy so it won't be carried again
          });
        }
      }
      if (toCarry.length > 0) {
        setShippingRecords([...workingAll, ...toCarry]);
        loadRecords();
      } else if (!cleanupDone) {
        loadRecords();
      }
    } else if (!cleanupDone) {
      loadRecords();
    }

    // Mark date as processed (persistent)
    processed.push(selectedDate);
    localStorage.setItem(flagKey, JSON.stringify(processed.slice(-90))); // keep last 90 days
    carriedOverRef.current.add(selectedDate);
  }, [selectedDate, loadRecords]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // Sync shipping creators to home performance data for 【査定】計算書作成
  function syncCreatorToPerformance() {
    const allRecords = getShippingRecords().filter(r => r.date === selectedDate);
    const perfData = getActualPerformanceForDate(selectedDate);
    const newPerfData = { ...perfData };

    // Count points per creator (by member name -> find member id)
    const creatorPoints: Record<string, { count: number; points: number }> = {};
    allRecords.forEach(r => {
      if (!r.creator) return;
      const member = members.find(m => m.name === r.creator);
      if (!member) return;
      if (!creatorPoints[member.id]) creatorPoints[member.id] = { count: 0, points: 0 };
      creatorPoints[member.id].count += 1;
      creatorPoints[member.id].points += r.points;
    });

    // Update performance data for 【査定】計算書作成
    const taskName = '【査定】計算書作成';
    for (const [memberId, data] of Object.entries(creatorPoints)) {
      if (!newPerfData[memberId]) newPerfData[memberId] = {};
      newPerfData[memberId][taskName] = { count: data.count, points: data.points };
    }

    // Clear data for members who no longer have records
    members.forEach(m => {
      if (!creatorPoints[m.id] && newPerfData[m.id]?.[taskName]) {
        newPerfData[m.id][taskName] = { count: 0, points: 0 };
      }
    });

    setActualPerformanceForDate(selectedDate, newPerfData);
  }

  // ===== Inline row helpers =====
  function updateRecord(id: string, patch: Partial<ShippingRecord>) {
    const all = getShippingRecords().map(r => r.id === id ? { ...r, ...patch } : r);
    setShippingRecords(all);
    loadRecords();
    if ('creator' in patch) {
      // Need small delay to ensure records are saved first
      setTimeout(() => syncCreatorToPerformance(), 50);
    }
  }

  function addRow() {
    const newRecord: ShippingRecord = {
      id: generateId(),
      date: selectedDate,
      carrier: '',
      dayType: '当日',
      itemCount: 1,
      parcels: 1,
      points: 0,
      inspector: '',
      creator: '',
      createdAt: new Date().toISOString(),
    };
    setShippingRecords([...getShippingRecords(), newRecord]);
    loadRecords();
  }

  function copyRow(source: ShippingRecord) {
    const newRecord: ShippingRecord = {
      ...source,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setShippingRecords([...getShippingRecords(), newRecord]);
    loadRecords();
  }

  function handleDelete(id: string) {
    setShippingRecords(getShippingRecords().filter(r => r.id !== id));
    loadRecords();
  }

  function handleExportCSV() {
    const data = records.map(r => ({
      日付: r.date, 配送業者: r.carrier, 区分: r.dayType || '当日',
      口数: getParcels(r), 点数: r.points, 検品者: r.inspector, 作成者: r.creator,
    }));
    exportToCSV(data, `shipping_${selectedDate}.csv`);
  }

  // Helper: get parcels count (default 1 for old records without parcels field)
  const getParcels = (r: ShippingRecord) => (r.parcels && r.parcels >= 1) ? r.parcels : 1;
  const sumParcels = (rs: ShippingRecord[]) => rs.reduce((s, r) => s + getParcels(r), 0);

  // Sorted records: 予定 (no creator) first, 実績済 (has creator) to the bottom
  const sortedRecords = [...records].sort((a, b) => {
    const aStatus = a.creator ? 1 : 0;
    const bStatus = b.creator ? 1 : 0;
    return aStatus - bStatus;
  });

  // Dashboard calculations - 件数 = record count, 口数 = parcels total
  const todayRecords = records.filter(r => (r.dayType || '当日') === '当日');
  const ryojitsuRecords = records.filter(r => (r.dayType || '') === '両日');

  // 当日
  const todayTotalCnt = todayRecords.length;
  const todayTotalParcels = sumParcels(todayRecords);
  const todayTotalPts = todayRecords.reduce((s, r) => s + r.points, 0);
  const todayDoneRecords = todayRecords.filter(r => r.creator);
  const todayDoneCnt = todayDoneRecords.length;
  const todayDoneParcels = sumParcels(todayDoneRecords);
  const todayDonePts = todayDoneRecords.reduce((s, r) => s + r.points, 0);
  const todayRemainCnt = todayTotalCnt - todayDoneCnt;
  const todayRemainParcels = todayTotalParcels - todayDoneParcels;
  const todayRemainPts = todayTotalPts - todayDonePts;

  // 両日
  const ryojitsuTotalCnt = ryojitsuRecords.length;
  const ryojitsuTotalParcels = sumParcels(ryojitsuRecords);
  const ryojitsuTotalPts = ryojitsuRecords.reduce((s, r) => s + r.points, 0);
  const ryojitsuDoneRecords = ryojitsuRecords.filter(r => r.creator);
  const ryojitsuDoneCnt = ryojitsuDoneRecords.length;
  const ryojitsuDoneParcels = sumParcels(ryojitsuDoneRecords);
  const ryojitsuDonePts = ryojitsuDoneRecords.reduce((s, r) => s + r.points, 0);
  const ryojitsuRemainCnt = ryojitsuTotalCnt - ryojitsuDoneCnt;
  const ryojitsuRemainParcels = ryojitsuTotalParcels - ryojitsuDoneParcels;
  const ryojitsuRemainPts = ryojitsuTotalPts - ryojitsuDonePts;

  // 実査定予定 & 残りリソース
  const dailyTasks = getDailyTasks().filter(t => t.date === selectedDate);
  const assessPlannedPoints = dailyTasks.filter(t => t.taskName === '【査定】計算書作成').reduce((s, t) => s + t.plannedCount, 0);
  const assessPlannedCount = dailyTasks.filter(t => t.taskName === '【補助】郵送物開封').reduce((s, t) => s + t.plannedCount, 0);
  const todayRemainResource = todayRemainPts * 2;
  const ryojitsuRemainResource = ryojitsuRemainPts * 2;

  // 合計 (当日 + 両日)
  const totalCnt = todayTotalCnt + ryojitsuTotalCnt;
  const totalPts = todayTotalPts + ryojitsuTotalPts;
  const totalDoneCnt = todayDoneCnt + ryojitsuDoneCnt;
  const totalDonePts = todayDonePts + ryojitsuDonePts;
  const totalRemainCnt = todayRemainCnt + ryojitsuRemainCnt;
  const totalRemainPts = todayRemainPts + ryojitsuRemainPts;

  // 郵便局AM率 (午前中の郵便局のみで抽出)
  const yubinAmRecords = records.filter(r => r.carrier === '郵便局（AM）');
  const yubinCnt = yubinAmRecords.length;
  const yubinPts = yubinAmRecords.reduce((s, r) => s + r.points, 0);
  const yubinCntRate = totalCnt > 0 ? Math.round((yubinCnt / totalCnt) * 100) : 0;
  const yubinPtsRate = totalPts > 0 ? Math.round((yubinPts / totalPts) * 100) : 0;

  // 配送業者別集計
  const carrierStats = CARRIERS.map(c => {
    const rs = records.filter(r => r.carrier === c);
    return {
      name: c,
      count: rs.length,
      parcels: sumParcels(rs),
      points: rs.reduce((s, r) => s + r.points, 0),
    };
  }).filter(c => c.count > 0);

  // 個人別集計（作成者ベース）
  const personOrder = ['和田', '潮田', '国兼', '熊谷', '鈴木', '三原', '加々美', '石井'];
  const personStats = personOrder.map(name => {
    const rs = records.filter(r => r.creator === name);
    return {
      name,
      count: rs.length,
      parcels: sumParcels(rs),
      points: rs.reduce((s, r) => s + r.points, 0),
    };
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">郵送点数</h1>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">{selectedDate}</span>
              <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
            </div>
            {/* 郵便局AM率（右上コンパクト） */}
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 text-xs flex items-center gap-3">
              <span className="font-bold text-rose-700">📮 郵便局AM率</span>
              <span className="text-rose-600"><b>{fmtNum(yubinCnt)}</b>/{fmtNum(totalCnt)}件 <b>({yubinCntRate}%)</b></span>
              <span className="text-rose-600"><b>{fmtNum(yubinPts)}</b>/{fmtNum(totalPts)}点 <b>({yubinPtsRate}%)</b></span>
            </div>
          </div>
        </div>

        {/* 実査定予定 & 残りリソース - TOP highlight */}
        <div className="bg-gradient-to-r from-indigo-50 to-amber-50 rounded-2xl border-2 border-indigo-300 shadow-md p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/80 rounded-xl px-4 py-4 border-l-4 border-indigo-500">
              <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider">実査定 予定点数</span>
              <p className="text-2xl font-extrabold text-indigo-700 mt-1">{fmtNum(assessPlannedPoints)}<span className="text-sm font-bold">点</span></p>
            </div>
            <div className="bg-white/80 rounded-xl px-4 py-4 border-l-4 border-indigo-500">
              <span className="text-[10px] text-indigo-600 font-bold uppercase tracking-wider">実査定 予定件数</span>
              <p className="text-2xl font-extrabold text-indigo-700 mt-1">{fmtNum(assessPlannedCount)}<span className="text-sm font-bold">件</span></p>
            </div>
            <div className="bg-white/80 rounded-xl px-4 py-4 border-l-4 border-red-500">
              <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">当日 残りリソース</span>
              <p className="text-2xl font-extrabold text-red-700 mt-1">{fmtNum(todayRemainResource)}<span className="text-sm font-bold">分</span></p>
              <p className="text-[10px] text-red-400 mt-0.5">（{fmtNum(todayRemainPts)}点 × 2分）</p>
            </div>
            <div className="bg-white/80 rounded-xl px-4 py-4 border-l-4 border-orange-500">
              <span className="text-[10px] text-orange-600 font-bold uppercase tracking-wider">両日 残りリソース</span>
              <p className="text-2xl font-extrabold text-orange-700 mt-1">{fmtNum(ryojitsuRemainResource)}<span className="text-sm font-bold">分</span></p>
              <p className="text-[10px] text-orange-400 mt-0.5">（{fmtNum(ryojitsuRemainPts)}点 × 2分）</p>
            </div>
          </div>
        </div>

        {/* 残り点数 視覚化グラフ */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
          <h3 className="text-sm font-bold text-gray-700">📊 進捗サマリー</h3>
          {(() => {
            const totalCntAll = todayTotalCnt + ryojitsuTotalCnt;
            const totalPtsAll = todayTotalPts + ryojitsuTotalPts;
            const doneCntAll = todayDoneCnt + ryojitsuDoneCnt;
            const donePtsAll = todayDonePts + ryojitsuDonePts;
            const remainCntAll = totalCntAll - doneCntAll;
            const remainPtsAll = totalPtsAll - donePtsAll;

            const ProgressBar = ({ label, done, total, remain, color, unit }: {
              label: string; done: number; total: number; remain: number; color: string; unit: string;
            }) => {
              const pct = total > 0 ? (done / total) * 100 : 0;
              const remainPct = 100 - pct;
              return (
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-bold text-gray-700">{label}</span>
                    <span>
                      <span className={color}><b>実績 {fmtNum(done)}{unit}</b></span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-700">予定 {fmtNum(total)}{unit}</span>
                      <span className="ml-2 text-red-600 font-bold">残り {fmtNum(remain)}{unit}</span>
                      <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${pct >= 100 ? 'bg-emerald-100 text-emerald-700' : pct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="h-5 w-full rounded-full overflow-hidden border border-gray-200 flex bg-gray-50">
                    <div className={`h-full transition-all ${color.replace('text-', 'bg-')} flex items-center justify-center`} style={{ width: `${pct}%` }}>
                      {pct >= 15 && <span className="text-[10px] text-white font-bold">{pct.toFixed(0)}%</span>}
                    </div>
                    <div className="h-full bg-red-100 flex items-center justify-center" style={{ width: `${remainPct}%` }}>
                      {remainPct >= 15 && remain > 0 && <span className="text-[10px] text-red-700 font-bold">残 {fmtNum(remain)}{unit}</span>}
                    </div>
                  </div>
                </div>
              );
            };

            return (
              <>
                {/* 当日 */}
                <div className="space-y-3">
                  <ProgressBar label="🟦 当日 件数" done={todayDoneCnt} total={todayTotalCnt} remain={todayRemainCnt} color="text-blue-600" unit="件" />
                  <ProgressBar label="🟦 当日 点数" done={todayDonePts} total={todayTotalPts} remain={todayRemainPts} color="text-blue-600" unit="点" />
                </div>
                {/* 両日 */}
                <div className="space-y-3 pt-3 border-t border-gray-100">
                  <ProgressBar label="🟪 両日 件数" done={ryojitsuDoneCnt} total={ryojitsuTotalCnt} remain={ryojitsuRemainCnt} color="text-purple-600" unit="件" />
                  <ProgressBar label="🟪 両日 点数" done={ryojitsuDonePts} total={ryojitsuTotalPts} remain={ryojitsuRemainPts} color="text-purple-600" unit="点" />
                </div>
                {/* 合計 */}
                <div className="space-y-3 pt-3 border-t-2 border-gray-300">
                  <ProgressBar label="⚫ 合計 件数" done={doneCntAll} total={totalCntAll} remain={remainCntAll} color="text-gray-700" unit="件" />
                  <ProgressBar label="⚫ 合計 点数" done={donePtsAll} total={totalPtsAll} remain={remainPtsAll} color="text-gray-700" unit="点" />
                </div>
              </>
            );
          })()}
        </div>


        {/* 配送業者別集計 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">配送業者別</h3>
          {carrierStats.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">記録がありません</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {carrierStats.map(c => (
                <div key={c.name} className="border border-indigo-100 rounded-lg px-2 py-2 bg-indigo-50/40">
                  <p className="text-[10px] text-indigo-700 font-semibold truncate" title={c.name}>{c.name}</p>
                  <p className="text-sm font-bold text-indigo-800 mt-0.5">
                    {fmtNum(c.count)}<span className="text-[10px] font-normal">件</span>
                    {c.parcels !== c.count && <span className="text-[10px] font-normal text-indigo-500">（{fmtNum(c.parcels)}件）</span>}
                    <span className="mx-1 text-gray-300">/</span>
                    {fmtNum(c.points)}<span className="text-[10px] font-normal">点</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 個人別（作成者）集計 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">個人別（作成者）</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
            {personStats.map(p => (
              <div key={p.name} className={`rounded-lg px-2 py-2 border ${p.count > 0 ? 'bg-emerald-50/60 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-[10px] font-semibold truncate ${p.count > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{p.name}</p>
                <p className={`text-sm font-bold mt-0.5 ${p.count > 0 ? 'text-emerald-800' : 'text-gray-400'}`}>
                  {fmtNum(p.count)}<span className="text-[10px] font-normal">件</span>
                  {p.parcels !== p.count && <span className={`text-[10px] font-normal ${p.count > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>（{fmtNum(p.parcels)}件）</span>}
                  <span className="mx-1 text-gray-300">/</span>
                  {fmtNum(p.points)}<span className="text-[10px] font-normal">点</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Records Table - split into 予定 (left) / 実績 (right) */}
        {(() => {
          const planRecords = records.filter(r => !r.creator);
          const doneRecords = records.filter(r => !!r.creator);
          const planPts = planRecords.reduce((s, r) => s + r.points, 0);
          const donePts = doneRecords.reduce((s, r) => s + r.points, 0);

          const renderRow = (r: ShippingRecord, isPlanSide: boolean) => {
            const isRyojitsu = (r.dayType || '当日') === '両日';
            const carrierClass = CARRIER_COLOR[r.carrier] || '';
            // focus-within highlights the row when any cell is focused
            // [&:has(td:focus-within)]:bg-amber-100 highlights the focused cell
            const cellFocusClass = 'focus:ring-4 focus:ring-amber-400 focus:ring-offset-1 focus:bg-amber-100 focus:font-bold focus:outline-none transition-all';
            return (
              <tr
                key={r.id}
                className={`border-b border-gray-50 text-center focus-within:bg-amber-50 focus-within:ring-2 focus-within:ring-amber-300 ${isPlanSide ? 'hover:bg-yellow-50/30' : 'bg-gray-100/40 hover:bg-gray-200/60'}`}
              >
                <td className="px-1 py-2">
                  <select
                    value={r.carrier}
                    onChange={e => updateRecord(r.id, { carrier: e.target.value })}
                    className={`w-full border rounded px-1 py-1 text-xs text-center ${carrierClass} ${cellFocusClass}`}
                  >
                    <option value="" className="bg-white text-gray-800">選択</option>
                    {CARRIERS.map(c => <option key={c} value={c} className="bg-white text-gray-800">{c}</option>)}
                  </select>
                </td>
                <td className="px-1 py-2">
                  <select
                    value={r.dayType || '当日'}
                    onChange={e => updateRecord(r.id, { dayType: e.target.value })}
                    className={`w-full rounded px-1 py-1 text-xs text-center ${isRyojitsu ? 'border-2 border-red-500 text-red-600 font-bold bg-transparent' : 'border'} ${cellFocusClass}`}
                  >
                    {DAY_TYPES.map(d => <option key={d} value={d} className="text-gray-800 bg-white">{d}</option>)}
                  </select>
                </td>
                <td className="px-1 py-2">
                  <input
                    type="number"
                    value={r.points}
                    min={0}
                    onChange={e => updateRecord(r.id, { points: Number(e.target.value) })}
                    className={`w-full border rounded px-1 py-1 text-xs text-center ${cellFocusClass}`}
                  />
                </td>
                <td className="px-1 py-2">
                  <select
                    value={r.creator}
                    onChange={e => updateRecord(r.id, { creator: e.target.value })}
                    className={`w-full border rounded px-1 py-1 text-xs text-center ${cellFocusClass}`}
                  >
                    <option value="">未入力</option>
                    {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </td>
                <td className="px-1 py-2">
                  <select
                    value={r.inspector}
                    onChange={e => updateRecord(r.id, { inspector: e.target.value })}
                    className={`w-full border rounded px-1 py-1 text-xs text-center ${cellFocusClass}`}
                  >
                    <option value="">選択</option>
                    {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                  </select>
                </td>
                <td className="px-1 py-2">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => copyRow(r)} className="text-blue-400 hover:text-blue-600 text-xs">コピー</button>
                    <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                  </div>
                </td>
              </tr>
            );
          };

          const renderTable = (rows: ShippingRecord[], isPlanSide: boolean) => (
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead className={isPlanSide ? 'bg-yellow-50' : 'bg-emerald-50'}>
                <tr className={`text-center ${isPlanSide ? 'text-yellow-800' : 'text-emerald-800'}`}>
                  <th className="px-1 py-3 font-semibold">配送業者</th>
                  <th className="px-1 py-3 font-semibold">区分</th>
                  <th className="px-1 py-3 font-semibold">点数</th>
                  <th className="px-1 py-3 font-semibold">作成者</th>
                  <th className="px-1 py-3 font-semibold">検品者</th>
                  <th className="px-1 py-3 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-xs">
                      {isPlanSide
                        ? '予定がありません。下の「+ 行を追加」から登録してください。'
                        : '実績がまだありません。予定の作成者を選択すると、ここに移動します。'}
                    </td>
                  </tr>
                ) : (
                  rows.map(r => renderRow(r, isPlanSide))
                )}
                {rows.length > 0 && (
                  <tr className={`font-bold text-center ${isPlanSide ? 'bg-yellow-50' : 'bg-emerald-50'}`}>
                    <td className={`px-1 py-3 ${isPlanSide ? 'text-yellow-800' : 'text-emerald-800'}`}>合計</td>
                    <td className="px-1 py-3"></td>
                    <td className={`px-1 py-3 ${isPlanSide ? 'text-yellow-800' : 'text-emerald-800'}`}>
                      {fmtNum(rows.reduce((s, r) => s + r.points, 0))}点
                    </td>
                    <td className="px-1 py-3"></td>
                    <td className="px-1 py-3"></td>
                    <td className={`px-1 py-3 text-xs font-normal ${isPlanSide ? 'text-yellow-700' : 'text-emerald-700'}`}>
                      {fmtNum(rows.length)}件
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          );

          return (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* 予定（左） */}
              <div className="bg-white rounded-xl shadow-sm border-2 border-yellow-200 overflow-hidden">
                <div className="bg-yellow-100 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-yellow-800 flex items-center gap-2">
                    📋 予定 <span className="text-[10px] bg-yellow-200 text-yellow-800 rounded-full px-2 py-0.5">{fmtNum(planRecords.length)}件 / {fmtNum(planPts)}点</span>
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  {renderTable(planRecords, true)}
                </div>
                <div className="px-4 py-3 border-t border-yellow-100 bg-yellow-50/40">
                  <button
                    onClick={addRow}
                    className="w-full border-2 border-dashed border-yellow-400 hover:border-yellow-500 hover:bg-yellow-50 text-yellow-700 text-sm font-semibold py-2 rounded-lg transition-colors"
                  >
                    + 行を追加
                  </button>
                </div>
              </div>

              {/* 実績（右） */}
              <div className="bg-white rounded-xl shadow-sm border-2 border-emerald-200 overflow-hidden">
                <div className="bg-emerald-100 border-b border-emerald-200 px-4 py-2 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-emerald-800 flex items-center gap-2">
                    ✅ 実績 <span className="text-[10px] bg-emerald-200 text-emerald-800 rounded-full px-2 py-0.5">{fmtNum(doneRecords.length)}件 / {fmtNum(donePts)}点</span>
                  </h3>
                  <span className="text-[10px] text-emerald-700">作成者を入力すると移動します</span>
                </div>
                <div className="overflow-x-auto">
                  {renderTable(doneRecords, false)}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </DashboardLayout>
  );
}
