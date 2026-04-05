'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShippingRecords, setShippingRecords, generateId, getToday, exportToCSV, getMemberById } from '@/lib/store';
import type { ShippingRecord } from '@/lib/types';

const CARRIERS = ['ヤマト運輸', '佐川急便', '日本郵便', 'その他'];

export default function ShippingPage() {
  const { members, dataVersion } = useAppContext();
  const [records, setRecordsState] = useState<ShippingRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [showForm, setShowForm] = useState(false);

  const [formCarrier, setFormCarrier] = useState('');
  const [formItemCount, setFormItemCount] = useState(0);
  const [formPoints, setFormPoints] = useState(0);
  const [formInspector, setFormInspector] = useState('');
  const [formCreator, setFormCreator] = useState('');

  const loadRecords = useCallback(() => {
    setRecordsState(getShippingRecords().filter(r => r.date === selectedDate));
  }, [selectedDate, dataVersion]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  function handleAdd() {
    if (!formCarrier || !formInspector || !formCreator) return;
    const newRecord: ShippingRecord = {
      id: generateId(),
      date: selectedDate,
      carrier: formCarrier,
      itemCount: formItemCount,
      points: formPoints,
      inspector: formInspector,
      creator: formCreator,
      createdAt: new Date().toISOString(),
    };
    const all = [...getShippingRecords(), newRecord];
    setShippingRecords(all);
    loadRecords();
    resetForm();
  }

  function resetForm() {
    setFormCarrier('');
    setFormItemCount(0);
    setFormPoints(0);
    setFormInspector('');
    setFormCreator('');
    setShowForm(false);
  }

  function handleDelete(id: string) {
    const all = getShippingRecords().filter(r => r.id !== id);
    setShippingRecords(all);
    loadRecords();
  }

  function handleExportCSV() {
    const data = records.map(r => ({
      日付: r.date,
      配送業者: r.carrier,
      件数: r.itemCount,
      点数: r.points,
      検品者: r.inspector,
      作成者: r.creator,
    }));
    exportToCSV(data, `shipping_${selectedDate}.csv`);
  }

  const totalItems = records.reduce((s, r) => s + r.itemCount, 0);
  const totalPoints = records.reduce((s, r) => s + r.points, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">郵送点数</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">+ 登録</button>
            <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
            <span className="text-xs text-gray-500">合計件数</span>
            <p className="text-2xl font-bold text-blue-700">{totalItems}</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
            <span className="text-xs text-gray-500">合計点数</span>
            <p className="text-2xl font-bold text-purple-700">{totalPoints}</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
            <span className="text-xs text-gray-500">登録件数</span>
            <p className="text-2xl font-bold text-green-700">{records.length}</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
            <span className="text-xs text-gray-500">平均点数/件</span>
            <p className="text-2xl font-bold text-orange-700">{totalItems > 0 ? (totalPoints / totalItems).toFixed(1) : '0'}</p>
          </div>
        </div>

        {/* Add Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-md border border-green-200 p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4">郵送記録を追加</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">配送業者</label>
                <select value={formCarrier} onChange={e => setFormCarrier(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択</option>
                  {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">件数</label>
                <input type="number" value={formItemCount} onChange={e => setFormItemCount(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">点数</label>
                <input type="number" value={formPoints} onChange={e => setFormPoints(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">検品者</label>
                <select value={formInspector} onChange={e => setFormInspector(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">作成者</label>
                <select value={formCreator} onChange={e => setFormCreator(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択</option>
                  {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button onClick={handleAdd} disabled={!formCarrier || !formInspector || !formCreator} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">追加</button>
            </div>
          </div>
        )}

        {/* Records Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-green-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold">配送業者</th>
                <th className="px-4 py-3 font-semibold">件数</th>
                <th className="px-4 py-3 font-semibold">点数</th>
                <th className="px-4 py-3 font-semibold">検品者</th>
                <th className="px-4 py-3 font-semibold">作成者</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">記録がありません</td></tr>
              ) : (
                records.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-green-50/30">
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{r.carrier}</span>
                    </td>
                    <td className="px-4 py-3 font-medium">{r.itemCount}</td>
                    <td className="px-4 py-3 font-medium">{r.points}</td>
                    <td className="px-4 py-3">{r.inspector}</td>
                    <td className="px-4 py-3">{r.creator}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
