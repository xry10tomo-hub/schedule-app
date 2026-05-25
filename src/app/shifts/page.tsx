'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShifts, setShifts, getMembers, setMembers, generateId, getDaysInMonth, exportToCSV } from '@/lib/store';
import type { ShiftEntry, Member } from '@/lib/types';

const PARTTIME_SHIFT_PRESETS = [
  { label: '10-14', start: '10:00', end: '14:00' },
  { label: '10-15', start: '10:00', end: '15:00' },
  { label: '10-18', start: '10:00', end: '18:00' },
  { label: '12:45-16:45', start: '12:45', end: '16:45' },
  { label: '15-20', start: '15:00', end: '20:00' },
  { label: '10-20', start: '10:00', end: '20:00' },
  { label: '12-22', start: '12:00', end: '22:00' },
];

const EMPLOYEE_SHIFT_PRESETS = [
  { label: '9:00-19:00', start: '09:00', end: '19:00' },
  { label: '9:00-19:30', start: '09:00', end: '19:30' },
  { label: '8:00-19:00', start: '08:00', end: '19:00' },
];

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export default function ShiftsPage() {
  const { members, dataVersion, refreshMembers } = useAppContext();
  const [shifts, setShiftsState] = useState<ShiftEntry[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectingCell, setSelectingCell] = useState<{ memberId: string; day: number } | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);

  const employees = members.filter(m => m.role === 'employee');
  const parttimers = members.filter(m => m.role === 'parttime');
  const allMembers = [...parttimers, ...employees];
  const daysInMonth = getDaysInMonth(year, month);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const loadShifts = useCallback(() => {
    setShiftsState(getShifts().filter(s => s.date.startsWith(monthStr)));
  }, [monthStr, dataVersion]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  // Auto-apply each member's weekly defaultShifts to days in the visible month that don't already
  // have a shift. Runs once per month-change. Skips today/past if user has explicitly removed them.
  useEffect(() => {
    const allShifts = getShifts();
    const newShifts: ShiftEntry[] = [];
    for (const m of members) {
      const pattern = m.defaultShifts;
      if (!pattern || Object.keys(pattern).length === 0) continue;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
        // Skip if a shift already exists OR an explicit "off" marker exists
        const exists = allShifts.some(s => s.memberId === m.id && s.date === dateStr);
        if (exists) continue;
        const dow = String(new Date(year, month, d).getDay());
        const tpl = pattern[dow];
        if (!tpl || !tpl.start || !tpl.end) continue; // dayOff in pattern
        newShifts.push({
          id: generateId(),
          memberId: m.id,
          date: dateStr,
          startTime: tpl.start,
          endTime: tpl.end,
          note: '',
        });
      }
    }
    if (newShifts.length > 0) {
      setShifts([...allShifts, ...newShifts]);
      loadShifts();
      console.log(`[Shifts] Auto-applied ${newShifts.length} default shifts for ${monthStr}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthStr, daysInMonth, members]);

  // Update a member's defaultShifts and persist
  function setMemberDefaultForDay(memberId: string, dow: string, value: { start: string; end: string } | null) {
    const all = getMembers();
    const updated = all.map(m => {
      if (m.id !== memberId) return m;
      const cur = { ...(m.defaultShifts || {}) };
      if (value === null) delete cur[dow];
      else cur[dow] = value;
      return { ...m, defaultShifts: cur };
    });
    setMembers(updated);
    refreshMembers();
  }

  function getShiftForMemberDay(memberId: string, day: number): ShiftEntry | undefined {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    return shifts.find(s => s.memberId === memberId && s.date === dateStr);
  }

  function handleCellClick(memberId: string, day: number) {
    setSelectingCell({ memberId, day });
  }

  function getPresetsForMember(memberId: string) {
    const member = members.find(m => m.id === memberId);
    return member?.role === 'employee' ? EMPLOYEE_SHIFT_PRESETS : PARTTIME_SHIFT_PRESETS;
  }

  function addShift(memberId: string, day: number, preset: { start: string; end: string }) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    const all = getShifts().filter(s => !(s.memberId === memberId && s.date === dateStr));
    const newShift: ShiftEntry = {
      id: generateId(),
      memberId,
      date: dateStr,
      startTime: preset.start,
      endTime: preset.end,
      note: '',
    };
    setShifts([...all, newShift]);
    loadShifts();
    setSelectingCell(null);
  }

  // Save custom time range (free-form input)
  function saveCustomShift(memberId: string, day: number, startTime: string, endTime: string) {
    if (!startTime || !endTime) return;
    // Validate format HH:MM
    const timeRegex = /^\d{1,2}:\d{2}$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      alert('時間はHH:MM形式で入力してください（例：10:30）');
      return;
    }
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    const all = getShifts().filter(s => !(s.memberId === memberId && s.date === dateStr));
    const newShift: ShiftEntry = {
      id: generateId(),
      memberId,
      date: dateStr,
      startTime: startTime.padStart(5, '0'),
      endTime: endTime.padStart(5, '0'),
      note: '',
    };
    setShifts([...all, newShift]);
    loadShifts();
    setSelectingCell(null);
  }

  function removeShift(memberId: string, day: number) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    const all = getShifts().filter(s => !(s.memberId === memberId && s.date === dateStr));
    setShifts(all);
    loadShifts();
    setSelectingCell(null);
  }

  function copyShiftToNextDay(memberId: string, day: number) {
    const shift = getShiftForMemberDay(memberId, day);
    if (!shift) return;
    // Calculate next day (may cross month boundary)
    const currentDate = new Date(year, month, day);
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    // Remove existing shift for next day, then add copy
    const all = getShifts().filter(s => !(s.memberId === memberId && s.date === nextDateStr));
    const newShift: ShiftEntry = {
      id: generateId(),
      memberId,
      date: nextDateStr,
      startTime: shift.startTime,
      endTime: shift.endTime,
      note: shift.note,
    };
    setShifts([...all, newShift]);
    loadShifts();
    setSelectingCell(null);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function handleExportCSV() {
    const data: Record<string, unknown>[] = [];
    allMembers.forEach(m => {
      for (let d = 1; d <= daysInMonth; d++) {
        const shift = getShiftForMemberDay(m.id, d);
        if (shift) {
          data.push({ 名前: m.name, 区分: m.role === 'employee' ? '社員' : 'アルバイト', 日付: shift.date, 開始: shift.startTime, 終了: shift.endTime, 備考: shift.note });
        }
      }
    });
    exportToCSV(data, `shifts_${monthStr}.csv`);
  }

  function calcShiftCounts(memberList: typeof members) {
    return memberList.map(m => ({
      name: m.name,
      count: shifts.filter(s => s.memberId === m.id).length,
      totalHours: shifts.filter(s => s.memberId === m.id).reduce((sum, s) => {
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        return sum + (eh * 60 + em - sh * 60 - sm) / 60;
      }, 0),
    }));
  }

  const parttimeShiftCounts = calcShiftCounts(parttimers);
  const employeeShiftCounts = calcShiftCounts(employees);

  function renderMemberRows(memberList: typeof members) {
    return memberList.map(m => (
      <tr key={m.id} className="border-b border-gray-50">
        <td className={`px-3 py-2 font-medium sticky left-0 z-10 ${m.role === 'employee' ? 'text-green-800 bg-green-50' : 'text-gray-800 bg-white'}`}>{m.name}</td>
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1;
          const shift = getShiftForMemberDay(m.id, d);
          const dayOfWeek = new Date(year, month, d).getDay();
          const isSelecting = selectingCell?.memberId === m.id && selectingCell?.day === d;
          const presets = getPresetsForMember(m.id);
          return (
            <td key={d} className="px-0.5 py-0.5 text-center relative">
              <div
                onClick={() => handleCellClick(m.id, d)}
                className={`cursor-pointer transition-colors rounded min-h-[36px] flex items-center justify-center ${
                  shift ? (m.role === 'employee' ? 'bg-green-200 hover:bg-green-300' : 'bg-blue-200 hover:bg-blue-300') :
                  dayOfWeek === 0 || dayOfWeek === 6 ? 'bg-gray-50 hover:bg-green-100' :
                  'hover:bg-green-100'
                }`}
              >
                {shift ? (
                  <div className={`text-[9px] font-medium leading-tight ${m.role === 'employee' ? 'text-green-800' : 'text-blue-800'}`}>
                    {shift.startTime.slice(0, 5)}
                    <br />~
                    <br />
                    {shift.endTime.slice(0, 5)}
                  </div>
                ) : null}
              </div>

              {isSelecting && (
                <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-xl p-2 w-48 space-y-1" onClick={e => e.stopPropagation()}>
                  <p className="text-xs font-semibold text-gray-600 mb-1">{m.name} - {d}日</p>
                  {presets.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => addShift(m.id, d, preset)}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                        shift?.startTime === preset.start && shift?.endTime === preset.end
                          ? 'bg-green-200 text-green-800 font-bold'
                          : 'bg-gray-50 text-gray-700 hover:bg-green-100'
                      }`}
                    >
                      {preset.start} - {preset.end}
                    </button>
                  ))}
                  {/* Custom time input */}
                  <CustomTimeInput
                    initialStart={shift?.startTime || ''}
                    initialEnd={shift?.endTime || ''}
                    onSave={(start, end) => saveCustomShift(m.id, d, start, end)}
                  />
                  {shift && (
                    <>
                      <button
                        onClick={() => copyShiftToNextDay(m.id, d)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >📋 翌日にコピー</button>
                      <button
                        onClick={() => removeShift(m.id, d)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs bg-red-50 text-red-600 hover:bg-red-100"
                      >削除</button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectingCell(null)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs bg-gray-100 text-gray-500 hover:bg-gray-200"
                  >閉じる</button>
                </div>
              )}
            </td>
          );
        })}
      </tr>
    ));
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">シフト一覧</h1>
          <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
        </div>

        <p className="text-sm text-gray-500">セルをクリックして時間帯を選択しシフトを追加できます。もう一度クリックで変更・削除が可能です。</p>

        {/* 週間デフォルトパターン編集 */}
        <div className="bg-white rounded-xl border-2 border-emerald-200 shadow-sm">
          <button
            onClick={() => setShowDefaults(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-emerald-50 rounded-t-xl"
          >
            <span className="text-sm font-bold text-emerald-700">
              🗓️ 週間デフォルトパターン（曜日ごとの固定シフト）— 設定すると毎月自動でこのパターンが反映されます
            </span>
            <span className="text-gray-400 text-xs">{showDefaults ? '▲ 閉じる' : '▼ 開く'}</span>
          </button>
          {showDefaults && (
            <div className="p-4 border-t border-emerald-100">
              <p className="text-xs text-gray-500 mb-3">
                各メンバーの曜日ごとの定時を選択。「休」=その曜日は出勤なし。設定後、シフト一覧で空いている日に自動反映されます（既存シフトは上書きしません）。
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      <th className="px-2 py-1.5 text-left font-medium sticky left-0 bg-white">メンバー</th>
                      {DAY_LABELS.map((label, i) => (
                        <th key={i} className={`px-2 py-1.5 text-center font-bold ${
                          i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-600'
                        }`}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allMembers.map(m => {
                      const presets = m.role === 'employee' ? EMPLOYEE_SHIFT_PRESETS : PARTTIME_SHIFT_PRESETS;
                      return (
                        <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className={`px-2 py-1.5 font-medium sticky left-0 bg-white ${m.role === 'employee' ? 'text-green-800' : 'text-blue-800'}`}>
                            {m.name}
                          </td>
                          {DAY_LABELS.map((_, dow) => {
                            const tpl = m.defaultShifts?.[String(dow)];
                            const currentValue = tpl ? `${tpl.start}-${tpl.end}` : '';
                            return (
                              <td key={dow} className="px-1 py-1 text-center">
                                <select
                                  value={currentValue}
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (!v) {
                                      setMemberDefaultForDay(m.id, String(dow), null);
                                    } else {
                                      const [start, end] = v.split('-');
                                      setMemberDefaultForDay(m.id, String(dow), { start, end });
                                    }
                                  }}
                                  className={`w-full border rounded px-1 py-0.5 text-[10px] ${
                                    tpl ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-gray-50 text-gray-400 border-gray-200'
                                  }`}
                                >
                                  <option value="">休</option>
                                  {presets.map(p => (
                                    <option key={p.label} value={`${p.start}-${p.end}`}>{p.label}</option>
                                  ))}
                                </select>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

        {/* Shift summary - Parttimers */}
        <div>
          <h3 className="text-sm font-bold text-blue-700 mb-2">アルバイト</h3>
          <div className="flex gap-3 flex-wrap">
            {parttimeShiftCounts.map(sc => (
              <div key={sc.name} className="bg-white rounded-lg px-3 py-2 border border-blue-100 shadow-sm text-sm">
                <span className="text-gray-600">{sc.name}:</span>
                <span className="font-bold text-blue-700 ml-1">{sc.count}日</span>
                <span className="text-gray-400 ml-1">({sc.totalHours.toFixed(1)}h)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Shift summary - Employees */}
        <div>
          <h3 className="text-sm font-bold text-green-700 mb-2">社員</h3>
          <div className="flex gap-3 flex-wrap">
            {employeeShiftCounts.map(sc => (
              <div key={sc.name} className="bg-white rounded-lg px-3 py-2 border border-green-100 shadow-sm text-sm">
                <span className="text-gray-600">{sc.name}:</span>
                <span className="font-bold text-green-700 ml-1">{sc.count}日</span>
                <span className="text-gray-400 ml-1">({sc.totalHours.toFixed(1)}h)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Note about custom time input */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
          💡 プリセットにない時間帯は「自由入力」からHH:MM形式（例：11:15）で設定可能です。
        </div>

        {/* Shift Grid */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto relative">
          <table className="text-xs min-w-full">
            <thead>
              <tr className="bg-green-50">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-green-50 z-10">名前</th>
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const d = i + 1;
                  const dayOfWeek = new Date(year, month, d).getDay();
                  return (
                    <th key={d} className={`px-1 py-2 text-center font-medium min-w-[44px] ${
                      dayOfWeek === 0 ? 'text-red-500' : dayOfWeek === 6 ? 'text-blue-500' : 'text-gray-600'
                    }`}>
                      <div>{d}</div>
                      <div className="text-[10px]">{['日','月','火','水','木','金','土'][dayOfWeek]}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Parttimers section */}
              <tr className="bg-blue-50">
                <td colSpan={daysInMonth + 1} className="px-3 py-1 text-xs font-bold text-blue-700 sticky left-0 bg-blue-50 z-10">アルバイト</td>
              </tr>
              {renderMemberRows(parttimers)}
              {/* Employees section */}
              <tr className="bg-green-50">
                <td colSpan={daysInMonth + 1} className="px-3 py-1 text-xs font-bold text-green-700 sticky left-0 bg-green-50 z-10">社員</td>
              </tr>
              {renderMemberRows(employees)}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}

// Free-form time input component for shifts
function CustomTimeInput({ initialStart, initialEnd, onSave }: { initialStart: string; initialEnd: string; onSave: (start: string, end: string) => void }) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  return (
    <div className="border-t border-gray-200 mt-1 pt-1">
      <p className="text-[10px] font-semibold text-gray-500 mb-1">自由入力</p>
      <div className="flex items-center gap-1">
        <input
          type="time"
          value={start}
          onChange={e => setStart(e.target.value)}
          className="w-[68px] border rounded px-1 py-0.5 text-[10px]"
          placeholder="HH:MM"
        />
        <span className="text-[10px] text-gray-400">〜</span>
        <input
          type="time"
          value={end}
          onChange={e => setEnd(e.target.value)}
          className="w-[68px] border rounded px-1 py-0.5 text-[10px]"
          placeholder="HH:MM"
        />
      </div>
      <button
        onClick={() => onSave(start, end)}
        disabled={!start || !end}
        className="mt-1 w-full text-[10px] bg-green-600 hover:bg-green-700 text-white rounded py-1 disabled:opacity-50"
      >保存</button>
    </div>
  );
}
