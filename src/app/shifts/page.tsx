'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getShifts, setShifts, generateId, getDaysInMonth, exportToCSV } from '@/lib/store';
import type { ShiftEntry } from '@/lib/types';

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

export default function ShiftsPage() {
  const { members, dataVersion } = useAppContext();
  const [shifts, setShiftsState] = useState<ShiftEntry[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectingCell, setSelectingCell] = useState<{ memberId: string; day: number } | null>(null);

  const employees = members.filter(m => m.role === 'employee');
  const parttimers = members.filter(m => m.role === 'parttime');
  const allMembers = [...parttimers, ...employees];
  const daysInMonth = getDaysInMonth(year, month);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  const loadShifts = useCallback(() => {
    setShiftsState(getShifts().filter(s => s.date.startsWith(monthStr)));
  }, [monthStr, dataVersion]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

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

  function removeShift(memberId: string, day: number) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    const all = getShifts().filter(s => !(s.memberId === memberId && s.date === dateStr));
    setShifts(all);
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
                <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-xl p-2 w-40 space-y-1" onClick={e => e.stopPropagation()}>
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
                  {shift && (
                    <button
                      onClick={() => removeShift(m.id, d)}
                      className="w-full text-left px-2 py-1.5 rounded text-xs bg-red-50 text-red-600 hover:bg-red-100"
                    >削除</button>
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
