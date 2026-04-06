'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShippingRecords, setShippingRecords, generateId, exportToCSV } from '@/lib/store';
import type { ShippingRecord } from '@/lib/types';

const CARRIERS = ['郵便局（AM）', 'ヤマト（AM）', '佐川（AM）', '郵便局（PM）', 'ヤマト（PM）', '佐川（PM）'];
const DAY_TYPES = ['当日', '両日'] as const;

export default function ShippingPage() {
  const { members, dataVersion, selectedDate } = useAppContext();
  const [records, setRecordsState] = useState<ShippingRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formCarrier, setFormCarrier] = useState('');
  const [formDayType, setFormDayType] = useState<string>('当日');
  const [formPoints, setFormPoints] = useState(0);
  const [formInspector, setFormInspector] = useState('');
  const [formCreator, setFormCreator] = useState('');

  const loadRecords = useCallback(() => {
    setRecordsState(getShippingRecords().filter(r => r.date === selectedDate));
  }, [selectedDate, dataVersion]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  function handleSave() {
    if (!formCarrier || !formInspector) return;
    if (editingId) {
      const all = getShippingRecords().map(r => {
        if (r.id !== editingId) return r;
        return { ...r, carrier: formCarrier, dayType: formDayType, itemCount: 1, points: formPoints, inspector: formInspector, creator: formCreator };
      });
      setShippingRecords(all);
    } else {
      const newRecord: ShippingRecord = {
        id: generateId(),
        date: selectedDate,
        carrier: formCarrier,
        dayType: formDayType,
        itemCount: 1, // auto: 1 record = 1 件
        points: formPoints,
        inspector: formInspector,
        creator: formCreator,
        createdAt: new Date().toISOString(),
      };
      setShippingRecords([...getShippingRecords(), newRecord]);
    }
    loadRecords();
    resetForm();
  }

  function startEdit(r: ShippingRecord) {
    setEditingId(r.id);
    setFormCarrier(r.carrier);
    setFormDayType(r.dayType || '当日');
    setFormPoints(r.points);
    setFormInspector(r.inspector);
    setFormCreator(r.creator);
    setShowForm(true);
  }

  function resetForm() {
    setEditingId(null);
    setFormCarrier('');
    setFormDayType('当日');
    setFormPoints(0);
    setFormInspector('');
    setFormCreator('');
    setShowForm(false);
  }

  function handleDelete(id: string) {
    setShippingRecords(getShippingRecords().filter(r => r.id !== id));
    loadRecords();
  }

  function handleUpdateCreator(id: string, creator: string) {
    const all = getShippingRecords().map(r => r.id === id ? { ...r, creator } : r);
    setShippingRecords(all);
    loadRecords();
  }

  function handleExportCSV() {
    const data = records.map(r => ({
      日付: r.date, 配送業者: r.carrier, 区分: r.dayType || '当日',
      点数: r.points, 検品者: r.inspector, 作成者: r.creator,
    }));
    exportToCSV(data, `shipping_${selectedDate}.csv`);
  }

  // Dashboard calculations - 件数 = record count
  const todayRecords = records.filter(r => (r.dayType || '当日') === '当日');
  const ryojitsuRecords = records.filter(r => (r.dayType || '') === '両日');

  // 当日
  const todayTotalCnt = todayRecords.length;
  const todayTotalPts = todayRecords.reduce((s, r) => s + r.points, 0);
  const todayDoneCnt = todayRecords.filter(r => r.creator).length;
  const todayDonePts = todayRecords.filter(r => r.creator).reduce((s, r) => s + r.points, 0);
  const todayRemainCnt = todayTotalCnt - todayDoneCnt;
  const todayRemainPts = todayTotalPts - todayDonePts;

  // 両日
  const ryojitsuTotalCnt = ryojitsuRecords.length;
  const ryojitsuTotalPts = ryojitsuRecords.reduce((s, r) => s + r.points, 0);
  const ryojitsuDoneCnt = ryojitsuRecords.filter(r => r.creator).length;
  const ryojitsuDonePts = ryojitsuRecords.filter(r => r.creator).reduce((s, r) => s + r.points, 0);
  const ryojitsuRemainCnt = ryojitsuTotalCnt - ryojitsuDoneCnt;
  const ryojitsuRemainPts = ryojitsuTotalPts - ryojitsuDonePts;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">郵送点数</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">{selectedDate}</span>
            <button onClick={() => { resetForm(); setShowForm(true); }} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">+ 登録</button>
            <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
          </div>
        </div>

        {/* Dashboard - 2 rows: 当日(top) / 両日(bottom) */}
        <div className="space-y-3">
          {/* 当日 row */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg px-3 py-3 border border-blue-200 shadow-sm">
              <span className="text-[10px] text-blue-600 font-bold">当日 予定件数</span>
              <p className="text-xl font-bold text-blue-700">{todayTotalCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-blue-200 shadow-sm">
              <span className="text-[10px] text-blue-600 font-bold">当日 予定点数</span>
              <p className="text-xl font-bold text-blue-700">{todayTotalPts}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-green-200 shadow-sm">
              <span className="text-[10px] text-green-600 font-bold">当日 実績件数</span>
              <p className="text-xl font-bold text-green-700">{todayDoneCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-green-200 shadow-sm">
              <span className="text-[10px] text-green-600 font-bold">当日 実績点数</span>
              <p className="text-xl font-bold text-green-700">{todayDonePts}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-red-200 shadow-sm">
              <span className="text-[10px] text-red-600 font-bold">当日 残り件数</span>
              <p className="text-xl font-bold text-red-700">{todayRemainCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-red-200 shadow-sm">
              <span className="text-[10px] text-red-600 font-bold">当日 残り点数</span>
              <p className="text-xl font-bold text-red-700">{todayRemainPts}<span className="text-sm">点</span></p>
            </div>
          </div>
          {/* 両日 row */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white rounded-lg px-3 py-3 border border-purple-200 shadow-sm">
              <span className="text-[10px] text-purple-600 font-bold">両日 予定件数</span>
              <p className="text-xl font-bold text-purple-700">{ryojitsuTotalCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-purple-200 shadow-sm">
              <span className="text-[10px] text-purple-600 font-bold">両日 予定点数</span>
              <p className="text-xl font-bold text-purple-700">{ryojitsuTotalPts}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-teal-200 shadow-sm">
              <span className="text-[10px] text-teal-600 font-bold">両日 実績件数</span>
              <p className="text-xl font-bold text-teal-700">{ryojitsuDoneCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-teal-200 shadow-sm">
              <span className="text-[10px] text-teal-600 font-bold">両日 実績点数</span>
              <p className="text-xl font-bold text-teal-700">{ryojitsuDonePts}<span className="text-sm">点</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-orange-200 shadow-sm">
              <span className="text-[10px] text-orange-600 font-bold">両日 残り件数</span>
              <p className="text-xl font-bold text-orange-700">{ryojitsuRemainCnt}<span className="text-sm">件</span></p>
            </div>
            <div className="bg-white rounded-lg px-3 py-3 border border-orange-200 shadow-sm">
              <span className="text-[10px] text-orange-600 font-bold">両日 残り点数</span>
              <p className="text-xl font-bold text-orange-700">{ryojitsuRemainPts}<span className="text-sm">点</span></p>
            </div>
          </div>
        </div>

        {/* Add/Edit Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-md border border-green-200 p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4">{editingId ? '記録を編集' : '郵送記録を追加'}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">配送業者 *</label>
                <select value={formCarrier} onChange={e => setFormCarrier(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択</option>
                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">区分 *</label>
                <select value={formDayType} onChange={e => setFormDayType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  {DAY_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">点数</label>
                <input type="number" value={formPoints} onChange={e => setFormPoints(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">検品者 *</label>
                <select value={formInspector} onChange={e => setFormInspector(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">作成者（任意）</label>
                <select value={formCreator} onChange={e => setFormCreator(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">未入力</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button onClick={handleSave} disabled={!formCarrier || !formInspector} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {editingId ? '更新' : '追加'}
              </button>
            </div>
          </div>
        )}

        {/* Records Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-green-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold">配送業者</th>
                <th className="px-4 py-3 font-semibold">区分</th>
                <th className="px-4 py-3 font-semibold">点数</th>
                <th className="px-4 py-3 font-semibold">検品者</th>
                <th className="px-4 py-3 font-semibold">作成者</th>
                <th className="px-4 py-3 font-semibold">状態</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">記録がありません</td></tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-green-50/30">
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{r.carrier}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${(r.dayType || '当日') === '当日' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>
                        {r.dayType || '当日'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{r.points}</td>
                    <td className="px-4 py-3">{r.inspector}</td>
                    <td className="px-4 py-3">
                      {r.creator ? (
                        <span className="text-green-700 font-medium">{r.creator}</span>
                      ) : (
                        <select
                          value=""
                          onChange={e => handleUpdateCreator(r.id, e.target.value)}
                          className="border rounded px-2 py-1 text-xs text-gray-500"
                        >
                          <option value="">作成者を選択</option>
                          {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.creator ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {r.creator ? '実績済' : '予定'}
                      </span>
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <button onClick={() => startEdit(r)} className="text-blue-500 hover:text-blue-700 text-xs">編集</button>
                      <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                    </td>
                  </tr>
                ))
              )}
              {records.length > 0 && (
                <tr className="bg-gray-50 font-bold">
                  <td className="px-4 py-3 text-gray-700">合計</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-gray-700">{records.reduce((s, r) => s + r.points, 0)}点</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-normal">{records.length}件</td>
                  <td className="px-4 py-3"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
