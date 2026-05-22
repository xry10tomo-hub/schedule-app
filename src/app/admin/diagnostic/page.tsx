'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { STORAGE_KEYS, SYNC_KEYS } from '@/lib/store';

type DumpRow = {
  key: string;
  exists: boolean;
  updatedAt: number | null;
  size: number;
  raw: unknown;
};

type DayCoverage = {
  date: string;
  perfMemberCount: number; // how many members have performance entries
  perfTaskCount: number;   // total task entries
  tlMemberCount: number;   // how many members have timeline blocks
  tlBlockCount: number;    // total timeline blocks across members
  dailyTaskCount: number;  // DailyTask records for this date
  dailyTaskActualMinutes: number; // sum of actualMinutes across DailyTasks for this date
};

export default function DiagnosticPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DumpRow[]>([]);
  const [coverage, setCoverage] = useState<DayCoverage[]>([]);
  const [month, setMonth] = useState('2026-05');
  const [err, setErr] = useState<string>('');

  async function loadAll() {
    setLoading(true);
    setErr('');
    try {
      const keys = Array.from(SYNC_KEYS);
      const out: DumpRow[] = [];
      for (const key of keys) {
        const snap = await getDoc(doc(db, 'appData', key));
        if (snap.exists()) {
          const data = snap.data();
          const value = data.value;
          const json = JSON.stringify(value ?? null);
          out.push({
            key,
            exists: true,
            updatedAt: data.updatedAt ?? null,
            size: json.length,
            raw: value,
          });
        } else {
          out.push({ key, exists: false, updatedAt: null, size: 0, raw: null });
        }
      }
      setRows(out);

      // Build coverage for the selected month
      const perf = out.find(r => r.key === STORAGE_KEYS.actualPerformance)?.raw as
        | Record<string, Record<string, Record<string, { count: number; points: number }>>>
        | undefined;
      const tl = out.find(r => r.key === STORAGE_KEYS.actualTimeline)?.raw as
        | Record<string, Record<string, Record<string, string>>>
        | undefined;
      const dailyTasks = out.find(r => r.key === STORAGE_KEYS.dailyTasks)?.raw as
        | Array<{ date: string; actualMinutes?: number; actualCount?: number; actualPoints?: number }>
        | undefined;

      const days = new Set<string>();
      if (perf) Object.keys(perf).filter(d => d.startsWith(month)).forEach(d => days.add(d));
      if (tl) Object.keys(tl).filter(d => d.startsWith(month)).forEach(d => days.add(d));
      if (dailyTasks) dailyTasks.filter(t => t.date?.startsWith(month)).forEach(t => days.add(t.date));
      // also include all days 1..31 even if empty
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      for (let d = 1; d <= lastDay; d++) {
        days.add(`${month}-${String(d).padStart(2, '0')}`);
      }

      const cov: DayCoverage[] = [];
      Array.from(days).sort().forEach(date => {
        const perfDay = perf?.[date] || {};
        const tlDay = tl?.[date] || {};
        let perfTaskCount = 0;
        Object.values(perfDay).forEach(taskMap => {
          Object.values(taskMap).forEach(entry => {
            if ((entry.count || 0) > 0 || (entry.points || 0) > 0) perfTaskCount += 1;
          });
        });
        let tlBlockCount = 0;
        Object.values(tlDay).forEach(blocks => {
          tlBlockCount += Object.keys(blocks).length;
        });
        const dtForDate = (dailyTasks || []).filter(t => t.date === date);
        const dailyTaskActualMinutes = dtForDate.reduce((s, t) => s + (t.actualMinutes || 0), 0);
        cov.push({
          date,
          perfMemberCount: Object.keys(perfDay).length,
          perfTaskCount,
          tlMemberCount: Object.keys(tlDay).length,
          tlBlockCount,
          dailyTaskCount: dtForDate.length,
          dailyTaskActualMinutes,
        });
      });
      setCoverage(cov);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firestore-dump-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">🔍 Firestore 診断ダンプ</h1>
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 mb-4 text-sm text-yellow-900">
          このページは Firestore の現状を直接読み出して表示します（書き込みは一切しません）。
        </div>

        <div className="flex gap-3 items-center mb-4">
          <label className="text-sm">対象月:</label>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="border rounded px-3 py-1"
          />
          <button
            onClick={loadAll}
            disabled={loading}
            className="px-4 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {loading ? '読込中...' : '🔄 再読込'}
          </button>
          <button
            onClick={downloadJSON}
            disabled={loading || rows.length === 0}
            className="px-4 py-1 bg-green-600 text-white rounded disabled:opacity-50"
          >
            📥 全データJSONダウンロード
          </button>
        </div>

        {err && <div className="bg-red-100 text-red-800 p-3 rounded mb-4">{err}</div>}

        {/* Sync keys overview */}
        <div className="bg-white rounded shadow p-4 mb-6">
          <h2 className="font-bold mb-2">Firestore 各キーの状態</h2>
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">キー</th>
                <th className="text-left p-2">存在</th>
                <th className="text-left p-2">最終更新</th>
                <th className="text-right p-2">サイズ(文字)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-t">
                  <td className="p-2 font-mono">{r.key}</td>
                  <td className="p-2">{r.exists ? '✅' : '❌ 無し'}</td>
                  <td className="p-2">
                    {r.updatedAt ? new Date(r.updatedAt).toLocaleString('ja-JP') : '-'}
                  </td>
                  <td className="p-2 text-right">{r.size.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Coverage for selected month */}
        <div className="bg-white rounded shadow p-4 mb-6">
          <h2 className="font-bold mb-2">{month} の日別データ存在状況</h2>
          <p className="text-xs text-gray-600 mb-2">
            実績時間タイムラインブロック(tlBlockCount) が 0 で、件数/点数(perfTaskCount) があれば「タイムラインだけ消えてる」状態です。
            DailyTask.actualMinutes に値があればそこから集計画面で表示できます。
          </p>
          <table className="w-full text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">日付</th>
                <th className="text-right p-2">perf<br />人数</th>
                <th className="text-right p-2">perf<br />件数/点数エントリ</th>
                <th className="text-right p-2">timeline<br />人数</th>
                <th className="text-right p-2">timeline<br />ブロック数</th>
                <th className="text-right p-2">DailyTask<br />件数</th>
                <th className="text-right p-2">DailyTask<br />actualMin合計</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map(c => {
                const tlMissing = c.tlBlockCount === 0 && (c.perfTaskCount > 0 || c.dailyTaskCount > 0);
                return (
                  <tr key={c.date} className={`border-t ${tlMissing ? 'bg-red-50' : ''}`}>
                    <td className="p-2 font-mono">{c.date}</td>
                    <td className="p-2 text-right">{c.perfMemberCount}</td>
                    <td className="p-2 text-right">{c.perfTaskCount}</td>
                    <td className={`p-2 text-right ${c.tlMemberCount === 0 ? 'text-red-600 font-bold' : ''}`}>
                      {c.tlMemberCount}
                    </td>
                    <td className={`p-2 text-right ${c.tlBlockCount === 0 ? 'text-red-600 font-bold' : ''}`}>
                      {c.tlBlockCount}
                    </td>
                    <td className="p-2 text-right">{c.dailyTaskCount}</td>
                    <td className="p-2 text-right">{c.dailyTaskActualMinutes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Raw JSON for actualTimeline and actualPerformance */}
        <details className="bg-white rounded shadow p-4 mb-4">
          <summary className="font-bold cursor-pointer">📄 actualTimeline の中身（生データ）</summary>
          <pre className="text-xs overflow-auto max-h-96 mt-3 bg-gray-50 p-2 rounded">
            {JSON.stringify(rows.find(r => r.key === STORAGE_KEYS.actualTimeline)?.raw, null, 2)}
          </pre>
        </details>
        <details className="bg-white rounded shadow p-4 mb-4">
          <summary className="font-bold cursor-pointer">📄 actualPerformance の中身（生データ）</summary>
          <pre className="text-xs overflow-auto max-h-96 mt-3 bg-gray-50 p-2 rounded">
            {JSON.stringify(rows.find(r => r.key === STORAGE_KEYS.actualPerformance)?.raw, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
