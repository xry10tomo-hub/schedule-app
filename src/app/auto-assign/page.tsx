'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getMembers, getTaskDefinitions, getDailyTasks, setDailyTasks, getShifts, generateId, getToday } from '@/lib/store';
import type { DailyTask, Member, TaskDefinition } from '@/lib/types';

interface AssignmentRequest {
  taskName: string;
  totalCount: number;
  priority: number; // 1=highest
}

interface AssignmentResult {
  memberId: string;
  memberName: string;
  taskName: string;
  count: number;
  estimatedMinutes: number;
}

function autoAssign(
  requests: AssignmentRequest[],
  availableMembers: Member[],
  taskDefs: TaskDefinition[],
  date: string
): AssignmentResult[] {
  const results: AssignmentResult[] = [];
  const memberMinutes: Record<string, number> = {};
  availableMembers.forEach(m => { memberMinutes[m.id] = 0; });

  // Sort by priority
  const sorted = [...requests].sort((a, b) => a.priority - b.priority);

  for (const req of sorted) {
    const def = taskDefs.find(t => t.name === req.taskName);
    if (!def) continue;

    // Find capable members sorted by speed (fastest first)
    const capableMembers = availableMembers
      .filter(m => m.skills.includes(req.taskName))
      .sort((a, b) => {
        const speedA = a.speedRatings[req.taskName] || def.estimatedMinutesPerUnit;
        const speedB = b.speedRatings[req.taskName] || def.estimatedMinutesPerUnit;
        return speedA - speedB;
      });

    if (capableMembers.length === 0) continue;

    let remaining = req.totalCount;

    // Distribute fairly based on speed and current load
    while (remaining > 0) {
      // Pick member with least minutes
      const nextMember = capableMembers.reduce((best, m) => {
        return (memberMinutes[m.id] || 0) < (memberMinutes[best.id] || 0) ? m : best;
      });

      const speed = nextMember.speedRatings[req.taskName] || def.estimatedMinutesPerUnit;
      // Assign batch: up to 60 min worth
      const batchCount = Math.min(remaining, Math.max(1, Math.floor(60 / speed)));
      const minutes = batchCount * speed;

      results.push({
        memberId: nextMember.id,
        memberName: nextMember.name,
        taskName: req.taskName,
        count: batchCount,
        estimatedMinutes: minutes,
      });

      memberMinutes[nextMember.id] = (memberMinutes[nextMember.id] || 0) + minutes;
      remaining -= batchCount;
    }
  }

  return results;
}

export default function AutoAssignPage() {
  const { members } = useAppContext();
  const [date, setDate] = useState(getToday());
  const [requests, setRequests] = useState<AssignmentRequest[]>([]);
  const [results, setResults] = useState<AssignmentResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const taskDefs = getTaskDefinitions();

  function addRequest() {
    setRequests([...requests, { taskName: '', totalCount: 0, priority: requests.length + 1 }]);
  }

  function updateRequest(index: number, field: keyof AssignmentRequest, value: string | number) {
    const updated = [...requests];
    updated[index] = { ...updated[index], [field]: value };
    setRequests(updated);
  }

  function removeRequest(index: number) {
    setRequests(requests.filter((_, i) => i !== index));
  }

  function runAutoAssign() {
    // Get members with shifts for this date, or all employees
    const shifts = getShifts().filter(s => s.date === date);
    const shiftMemberIds = shifts.map(s => s.memberId);
    const allEmployees = members.filter(m => m.role === 'employee');
    const shiftMembers = members.filter(m => shiftMemberIds.includes(m.id));
    const availableMembers = [...allEmployees, ...shiftMembers.filter(m => m.role === 'parttime')];
    // Deduplicate
    const uniqueMembers = availableMembers.filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i);

    const assignResults = autoAssign(requests, uniqueMembers, taskDefs, date);
    setResults(assignResults);
    setShowResults(true);
  }

  function applyResults() {
    const existing = getDailyTasks();
    const newTasks: DailyTask[] = results.map(r => {
      const def = taskDefs.find(t => t.name === r.taskName);
      const mpu = def?.estimatedMinutesPerUnit || 0;
      return {
        id: generateId(),
        date,
        taskName: r.taskName,
        assigneeId: r.memberId,
        plannedCount: r.count,
        minutesPerUnit: mpu,
        plannedPoints: (def?.defaultPointsPerUnit || 1) * r.count,
        plannedMinutes: r.estimatedMinutes,
        actualCount: 0,
        actualPoints: 0,
        actualMinutes: 0,
        startTime: '09:00',
        endTime: '18:00',
        status: 'pending' as const,
        comment: '自動割振',
      };
    });
    setDailyTasks([...existing, ...newTasks]);
    alert('日次業務に反映しました！');
  }

  // Aggregate results by member
  const memberSummary = results.reduce((acc, r) => {
    if (!acc[r.memberId]) acc[r.memberId] = { name: r.memberName, totalMinutes: 0, tasks: [] };
    acc[r.memberId].totalMinutes += r.estimatedMinutes;
    acc[r.memberId].tasks.push(r);
    return acc;
  }, {} as Record<string, { name: string; totalMinutes: number; tasks: AssignmentResult[] }>);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">自動割振</h1>
            <p className="text-sm text-gray-500 mt-1">AIがメンバーのスキルとスピードを考慮して最適な業務割振を提案します</p>
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
        </div>

        {/* Input Requests */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-gray-800">業務リクエスト</h3>
            <button onClick={addRequest} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
              + 業務追加
            </button>
          </div>

          {requests.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">「+ 業務追加」ボタンで割り振りたい業務を追加してください</p>
          ) : (
            <div className="space-y-3">
              {requests.map((req, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                  <span className="text-sm font-semibold text-gray-500 w-8">#{i + 1}</span>
                  <select value={req.taskName} onChange={e => updateRequest(i, 'taskName', e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1">
                    <option value="">業務を選択</option>
                    {taskDefs.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500">件数:</label>
                    <input type="number" value={req.totalCount} onChange={e => updateRequest(i, 'totalCount', Number(e.target.value))} className="w-20 border rounded-lg px-2 py-2 text-sm" min={0} />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500">優先度:</label>
                    <input type="number" value={req.priority} onChange={e => updateRequest(i, 'priority', Number(e.target.value))} className="w-16 border rounded-lg px-2 py-2 text-sm" min={1} />
                  </div>
                  <button onClick={() => removeRequest(i)} className="text-red-400 hover:text-red-600">
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="4" x2="14" y2="14"/><line x1="14" y1="4" x2="4" y2="14"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {requests.length > 0 && (
            <div className="mt-4 flex justify-end">
              <button onClick={runAutoAssign} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg transition-all">
                自動割振を実行
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        {showResults && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">割振結果</h3>
              <button onClick={applyResults} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors">
                日次業務に反映
              </button>
            </div>

            {/* Per-member summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(memberSummary).map(([id, data]) => (
                <div key={id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="font-bold text-gray-800">{data.name}</h4>
                    <span className="text-sm font-semibold text-green-700">{data.totalMinutes}分 ({(data.totalMinutes / 60).toFixed(1)}h)</span>
                  </div>
                  <div className="space-y-1">
                    {data.tasks.map((t, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600">{t.taskName} x{t.count}</span>
                        <span className="text-gray-500">{t.estimatedMinutes}分</span>
                      </div>
                    ))}
                  </div>
                  {/* Load bar */}
                  <div className="mt-3">
                    <div className="bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-full rounded-full animate-progress ${
                          data.totalMinutes > 480 ? 'bg-red-400' : data.totalMinutes > 360 ? 'bg-yellow-400' : 'bg-green-400'
                        }`}
                        style={{ width: `${Math.min(100, (data.totalMinutes / 480) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{Math.round((data.totalMinutes / 480) * 100)}% (8h基準)</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Detailed table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-green-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">担当者</th>
                    <th className="px-4 py-3 font-semibold">業務名</th>
                    <th className="px-4 py-3 font-semibold">件数</th>
                    <th className="px-4 py-3 font-semibold">見積時間</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-green-50/30">
                      <td className="px-4 py-3 font-medium">{r.memberName}</td>
                      <td className="px-4 py-3">{r.taskName}</td>
                      <td className="px-4 py-3">{r.count}</td>
                      <td className="px-4 py-3">{r.estimatedMinutes}分</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
