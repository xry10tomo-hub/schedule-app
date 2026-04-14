'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShippingRecords, setShippingRecords, generateId, exportToCSV, fmtNum } from '@/lib/store';
import type { ShippingRecord } from '@/lib/types';

const CARRIERS = ['郵便局（AM）', 'ヤマト（AM）', '佐川（AM）', '郵便局（PM）', 'ヤマト（PM）', '佐川（PM）'];
const DAY_TYPES = ['当日', '両日'] as const;

export default function ShippingPage() {
  const { members, dataVersion, selectedDate } = useAppContext();
  const [records, setRecordsState] = useState<ShippingRecord[]>([]);

  const loadRecords = useCallback(() => {
    setRecordsState(getShippingRecords().filter(r => r.date === selectedDate));
  }, [selectedDate, dataVersion]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // ===== Inline row helpers =====
  function updateRecord(id: string, patch: Partial<ShippingRecord>) {
    const all = getShippingRecords().map(r => r.id === id ? { ...r, ...patch } : r);
    setShippingRecords(all);
    loadRecords();
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
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">{selectedDate}</span>
            <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
          </div>
        </div>

        {/* Dashboard - 2 rows: 当日(top) / 両日(bottom) */}
        <div className="space-y-3">
          {/* 当日 row */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg px-3 py-3 border border-blue-200 shadow-sm">
              <span className="text-[10px] text-blue-600 font-bold">当日 予定件数</span>
              <p className="text-xl font-bold text-blue-700">{fmtNum(todayTotalCnt)}<span className="text-sm">件</span></p>
              {todayTotalParcels !== todayTotalCnt && <p className="text-[10px] text-blue-500">（{fmtNum(todayTotalParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-blue-200 shadow-sm">
              <span className="text-[10px] text-blue-600 font-bold">当日 予定点数</span>
              <p className="text-xl font-bold text-blue-700">{fmtNum(todayTotalPts)}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-green-200 shadow-sm">
              <span className="text-[10px] text-green-600 font-bold">当日 実績件数</span>
              <p className="text-xl font-bold text-green-700">{fmtNum(todayDoneCnt)}<span className="text-sm">件</span></p>
              {todayDoneParcels !== todayDoneCnt && <p className="text-[10px] text-green-500">（{fmtNum(todayDoneParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-green-200 shadow-sm">
              <span className="text-[10px] text-green-600 font-bold">当日 実績点数</span>
              <p className="text-xl font-bold text-green-700">{fmtNum(todayDonePts)}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-red-200 shadow-sm">
              <span className="text-[10px] text-red-600 font-bold">当日 残り件数</span>
              <p className="text-xl font-bold text-red-700">{fmtNum(todayRemainCnt)}<span className="text-sm">件</span></p>
              {todayRemainParcels !== todayRemainCnt && <p className="text-[10px] text-red-500">（{fmtNum(todayRemainParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-red-200 shadow-sm">
              <span className="text-[10px] text-red-600 font-bold">当日 残り点数</span>
              <p className="text-xl font-bold text-red-700">{fmtNum(todayRemainPts)}<span className="text-sm">点</span></p>
            </div>
          </div>
          {/* 両日 row */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg px-3 py-3 border border-purple-200 shadow-sm">
              <span className="text-[10px] text-purple-600 font-bold">両日 予定件数</span>
              <p className="text-xl font-bold text-purple-700">{fmtNum(ryojitsuTotalCnt)}<span className="text-sm">件</span></p>
              {ryojitsuTotalParcels !== ryojitsuTotalCnt && <p className="text-[10px] text-purple-500">（{fmtNum(ryojitsuTotalParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-purple-200 shadow-sm">
              <span className="text-[10px] text-purple-600 font-bold">両日 予定点数</span>
              <p className="text-xl font-bold text-purple-700">{fmtNum(ryojitsuTotalPts)}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-teal-200 shadow-sm">
              <span className="text-[10px] text-teal-600 font-bold">両日 実績件数</span>
              <p className="text-xl font-bold text-teal-700">{fmtNum(ryojitsuDoneCnt)}<span className="text-sm">件</span></p>
              {ryojitsuDoneParcels !== ryojitsuDoneCnt && <p className="text-[10px] text-teal-500">（{fmtNum(ryojitsuDoneParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-teal-200 shadow-sm">
              <span className="text-[10px] text-teal-600 font-bold">両日 実績点数</span>
              <p className="text-xl font-bold text-teal-700">{fmtNum(ryojitsuDonePts)}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-orange-200 shadow-sm">
              <span className="text-[10px] text-orange-600 font-bold">両日 残り件数</span>
              <p className="text-xl font-bold text-orange-700">{fmtNum(ryojitsuRemainCnt)}<span className="text-sm">件</span></p>
              {ryojitsuRemainParcels !== ryojitsuRemainCnt && <p className="text-[10px] text-orange-500">（{fmtNum(ryojitsuRemainParcels)}口）</p>}
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-orange-200 shadow-sm">
              <span className="text-[10px] text-orange-600 font-bold">両日 残り点数</span>
              <p className="text-xl font-bold text-orange-700">{fmtNum(ryojitsuRemainPts)}<span className="text-sm">点</span></p>
            </div>
          </div>
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
                    {c.parcels !== c.count && <span className="text-[10px] font-normal text-indigo-500">（{fmtNum(c.parcels)}口）</span>}
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
                  {p.parcels !== p.count && <span className={`text-[10px] font-normal ${p.count > 0 ? 'text-emerald-500' : 'text-gray-400'}`}>（{fmtNum(p.parcels)}口）</span>}
                  <span className="mx-1 text-gray-300">/</span>
                  {fmtNum(p.points)}<span className="text-[10px] font-normal">点</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Records Table - inline edit */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-green-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold">配送業者</th>
                <th className="px-4 py-3 font-semibold">区分</th>
                <th className="px-4 py-3 font-semibold">口数</th>
                <th className="px-4 py-3 font-semibold">点数</th>
                <th className="px-4 py-3 font-semibold">検品者</th>
                <th className="px-4 py-3 font-semibold">作成者</th>
                <th className="px-4 py-3 font-semibold">状態</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">記録がありません。下の「+ 行を追加」から登録してください。</td></tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-green-50/30">
                    <td className="px-3 py-2">
                      <select
                        value={r.carrier}
                        onChange={e => updateRecord(r.id, { carrier: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-xs"
                      >
                        <option value="">選択</option>
                        {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.dayType || '当日'}
                        onChange={e => updateRecord(r.id, { dayType: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-xs"
                      >
                        {DAY_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={getParcels(r)}
                        min={1}
                        onChange={e => updateRecord(r.id, { parcels: Math.max(1, Number(e.target.value)) })}
                        className="w-16 border rounded px-2 py-1 text-xs text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={r.points}
                        min={0}
                        onChange={e => updateRecord(r.id, { points: Number(e.target.value) })}
                        className="w-20 border rounded px-2 py-1 text-xs text-right"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.inspector}
                        onChange={e => updateRecord(r.id, { inspector: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-xs"
                      >
                        <option value="">選択</option>
                        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.creator}
                        onChange={e => updateRecord(r.id, { creator: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-xs"
                      >
                        <option value="">未入力</option>
                        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.creator ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {r.creator ? '実績済' : '予定'}
                      </span>
                    </td>
                    <td className="px-3 py-2 flex gap-2">
                      <button onClick={() => copyRow(r)} className="text-blue-400 hover:text-blue-600 text-xs">コピー</button>
                      <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                    </td>
                  </tr>
                ))
              )}
              {records.length > 0 && (
                <tr className="bg-gray-50 font-bold">
                  <td className="px-4 py-3 text-gray-700">合計</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-gray-700">{fmtNum(sumParcels(records))}口</td>
                  <td className="px-4 py-3 text-gray-700">{fmtNum(records.reduce((s, r) => s + r.points, 0))}点</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-normal">{fmtNum(records.length)}件</td>
                  <td className="px-4 py-3"></td>
                </tr>
              )}
            </tbody>
          </table>
          {/* Inline add button under the table */}
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <button
              onClick={addRow}
              className="w-full border-2 border-dashed border-green-300 hover:border-green-500 hover:bg-green-50 text-green-700 text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              + 行を追加
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
