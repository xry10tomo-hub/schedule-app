'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { STORAGE_KEYS, SYNC_KEYS } from '@/lib/store';
import { listBackups, createManualBackup, restoreKeyFromBackup, type BackupSummary } from '@/lib/backup';

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
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreDate, setRestoreDate] = useState('');
  const [restoreKey, setRestoreKey] = useState<string>(STORAGE_KEYS.actualTimeline);
  const [restoreMode, setRestoreMode] = useState<'replace' | 'merge'>('merge');

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
    loadBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadBackups() {
    try {
      const list = await listBackups();
      setBackups(list);
    } catch (e) {
      console.error('listBackups error', e);
    }
  }

  async function handleManualBackup() {
    if (!confirm('現在の Firestore データをスナップショットとして保存します。よろしいですか？')) return;
    setBackupBusy(true);
    try {
      const date = await createManualBackup();
      alert(`バックアップ完了: ${date}`);
      await loadBackups();
    } catch (e) {
      alert('バックアップ失敗: ' + String(e));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestore() {
    if (!restoreDate) { alert('復元元の日付を選択してください'); return; }
    const modeLabel = restoreMode === 'replace' ? '完全上書き' : 'マージ（既存優先で穴埋め）';
    if (!confirm(`${restoreDate} のバックアップから "${restoreKey}" を ${modeLabel} で復元します。よろしいですか？`)) return;
    setBackupBusy(true);
    try {
      await restoreKeyFromBackup(restoreDate, restoreKey, restoreMode);
      alert('復元完了。ページをリロードしてください。');
    } catch (e) {
      alert('復元失敗: ' + String(e));
    } finally {
      setBackupBusy(false);
    }
  }

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

        {/* Backup management */}
        <div className="bg-white rounded shadow p-4 mb-6 border-2 border-emerald-200">
          <h2 className="font-bold mb-2 text-emerald-800">🗄️ 自動バックアップ管理</h2>
          <p className="text-xs text-gray-600 mb-3">
            毎日のアプリ起動時に Firestore の全データを <code className="bg-gray-100 px-1">appDataBackups/YYYY-MM-DD</code> に自動スナップショット。
            過去30日分を自動保持します。
          </p>

          <div className="flex gap-2 mb-4">
            <button
              onClick={handleManualBackup}
              disabled={backupBusy}
              className="px-4 py-1 bg-emerald-600 text-white rounded text-sm disabled:opacity-50"
            >
              📸 今すぐ手動バックアップ
            </button>
            <button onClick={loadBackups} className="px-4 py-1 bg-gray-500 text-white rounded text-sm">🔄 一覧更新</button>
          </div>

          <div className="mb-4">
            <h3 className="font-semibold text-sm mb-1">保存済みバックアップ ({backups.length}件)</h3>
            {backups.length === 0 ? (
              <p className="text-xs text-gray-500">まだバックアップがありません。</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2">日付</th>
                    <th className="text-left p-2">作成日時</th>
                    <th className="text-right p-2">サイズ(文字)</th>
                    <th className="text-left p-2">含まれるキー数</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.date} className="border-t">
                      <td className="p-2 font-mono">{b.date}</td>
                      <td className="p-2">{b.createdAt ? new Date(b.createdAt).toLocaleString('ja-JP') : '-'}</td>
                      <td className="p-2 text-right">{b.size.toLocaleString()}</td>
                      <td className="p-2">{b.keys.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t pt-3">
            <h3 className="font-semibold text-sm mb-2">🔧 バックアップから復元</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
              <div>
                <label className="text-xs text-gray-600 block mb-1">復元元の日付</label>
                <select value={restoreDate} onChange={e => setRestoreDate(e.target.value)} className="border rounded px-2 py-1 w-full text-sm">
                  <option value="">-- 選択 --</option>
                  {backups.map(b => (<option key={b.date} value={b.date}>{b.date}</option>))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">復元するキー</label>
                <select value={restoreKey} onChange={e => setRestoreKey(e.target.value)} className="border rounded px-2 py-1 w-full text-sm">
                  {Array.from(SYNC_KEYS).map(k => (<option key={k} value={k}>{k}</option>))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">モード</label>
                <select value={restoreMode} onChange={e => setRestoreMode(e.target.value as 'replace' | 'merge')} className="border rounded px-2 py-1 w-full text-sm">
                  <option value="merge">マージ（既存優先で穴埋め）</option>
                  <option value="replace">完全上書き（注意）</option>
                </select>
              </div>
              <div className="flex items-end">
                <button onClick={handleRestore} disabled={backupBusy || !restoreDate} className="w-full px-4 py-1 bg-orange-600 text-white rounded text-sm disabled:opacity-50">
                  ⚠️ 復元実行
                </button>
              </div>
            </div>
            <p className="text-[10px] text-gray-500">
              ※ マージ: バックアップは「穴埋め」専用。現在のデータが優先され、バックアップにしかないエントリだけが追加される。
              ※ 完全上書き: 現在のデータがバックアップ時点に巻き戻る（取り扱い注意）。
            </p>
          </div>
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
