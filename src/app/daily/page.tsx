'use client';

import { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getDailyTasks, setDailyTasks, getTaskDefinitions, getMonthlySchedules, getShifts, generateId, getToday, exportToCSV, getMemberById, TASK_CATEGORIES, FIXED_TASK_NAMES, DEFAULT_TASKS } from '@/lib/store';
import type { DailyTask, TaskDefinition } from '@/lib/types';

export default function DailyPage() {
  const { members, currentUserId, dataVersion } = useAppContext();
  const [tasks, setTasksState] = useState<DailyTask[]>([]);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [showForm, setShowForm] = useState(false);
  const [taskDefs, setTaskDefsState] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [viewTab, setViewTab] = useState<'plan' | 'actual'>('plan');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Form state
  const [formCategory, setFormCategory] = useState('');
  const [formTask, setFormTask] = useState('');
  const [formAssignee, setFormAssignee] = useState(currentUserId);
  const [formRequiredCount, setFormRequiredCount] = useState(1);
  const [formMinutesPerUnit, setFormMinutesPerUnit] = useState(0);
  const [formComment, setFormComment] = useState('');

  const tasksByCategory = TASK_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = taskDefs.filter(t => t.category === cat);
    return acc;
  }, {} as Record<string, TaskDefinition[]>);

  const syncMonthlyTasks = useCallback(() => {
    const monthlySchedules = getMonthlySchedules().filter(s => s.date === selectedDate);
    const existingDaily = getDailyTasks();
    const dailyForDate = existingDaily.filter(t => t.date === selectedDate);

    let added = false;
    const newTasks = [...existingDaily];

    // Collect task names to add (expand 固定業務 into individual tasks)
    const taskNamesToAdd: string[] = [];
    for (const ms of monthlySchedules) {
      if (ms.taskName === '固定業務') {
        taskNamesToAdd.push(...FIXED_TASK_NAMES);
      } else {
        taskNamesToAdd.push(ms.taskName);
      }
    }

    const uniqueTaskNames = [...new Set(taskNamesToAdd)];

    for (const taskName of uniqueTaskNames) {
      const alreadyExists = dailyForDate.some(t => t.taskName === taskName);
      if (!alreadyExists) {
        const def = DEFAULT_TASKS.find(d => d.name === taskName);
        newTasks.push({
          id: generateId(),
          date: selectedDate,
          taskName,
          assigneeId: '',
          plannedCount: 1,
          minutesPerUnit: def?.estimatedMinutesPerUnit || 0,
          plannedMinutes: def?.estimatedMinutesPerUnit || 0,
          plannedPoints: 0,
          actualCount: 0,
          actualPoints: 0,
          actualMinutes: 0,
          startTime: '09:00',
          endTime: '18:00',
          status: 'pending',
          comment: '月次予定から自動反映',
        });
        added = true;
      }
    }

    if (added) {
      setDailyTasks(newTasks);
    }
    return newTasks.filter(t => t.date === selectedDate);
  }, [selectedDate]);

  const loadTasks = useCallback(() => {
    setTaskDefsState(getTaskDefinitions());
    const tasksForDate = syncMonthlyTasks();
    setTasksState(tasksForDate);
  }, [syncMonthlyTasks, dataVersion]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  function handleAddTask() {
    if (!formTask) return;
    const def = taskDefs.find(t => t.name === formTask);
    const mpu = formMinutesPerUnit || def?.estimatedMinutesPerUnit || 0;
    const newTask: DailyTask = {
      id: generateId(),
      date: selectedDate,
      taskName: formTask,
      assigneeId: formAssignee,
      plannedCount: formRequiredCount,
      minutesPerUnit: mpu,
      plannedMinutes: formRequiredCount * mpu,
      plannedPoints: 0,
      actualCount: 0,
      actualPoints: 0,
      actualMinutes: 0,
      startTime: '09:00',
      endTime: '18:00',
      status: 'pending',
      comment: formComment,
    };
    const all = [...getDailyTasks(), newTask];
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
    resetForm();
  }

  function resetForm() {
    setFormCategory('');
    setFormTask('');
    setFormAssignee(currentUserId);
    setFormRequiredCount(1);
    setFormMinutesPerUnit(0);
    setFormComment('');
    setShowForm(false);
  }

  function handleUpdateField(id: string, field: string, value: number | string) {
    const all = getDailyTasks().map(t => {
      if (t.id !== id) return t;
      const updated = { ...t, [field]: value };
      // Auto-recalculate plannedMinutes when count or minutesPerUnit changes
      if (field === 'plannedCount' || field === 'minutesPerUnit') {
        const count = field === 'plannedCount' ? (value as number) : t.plannedCount;
        const mpu = field === 'minutesPerUnit' ? (value as number) : (t.minutesPerUnit || 0);
        updated.plannedMinutes = count * mpu;
      }
      return updated;
    });
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
  }

  function handleDeleteTask(id: string) {
    const all = getDailyTasks().filter(t => t.id !== id);
    setDailyTasks(all);
    setTasksState(all.filter(t => t.date === selectedDate));
  }

  function handleExportCSV() {
    const data = tasks.map(t => ({
      日付: t.date,
      業務名: t.taskName,
      担当者: getMemberById(t.assigneeId)?.name || '',
      必要件数: t.plannedCount,
      '1回あたり時間_分': t.minutesPerUnit || 0,
      必要時間_分: t.plannedMinutes,
      実績件数: t.actualCount,
      実績点数: t.actualPoints,
      実績時間_分: t.actualMinutes,
      ステータス: t.status === 'completed' ? '完了' : t.status === 'in_progress' ? '進行中' : '未着手',
      コメント: t.comment,
    }));
    exportToCSV(data, `daily_tasks_${selectedDate}.csv`);
  }

  function handleTaskSelect(taskName: string) {
    setFormTask(taskName);
    const def = taskDefs.find(t => t.name === taskName);
    if (def) {
      setFormMinutesPerUnit(def.estimatedMinutesPerUnit);
    }
  }

  function handleCategoryChange(cat: string) {
    setFormCategory(cat);
    setFormTask('');
  }

  const filteredFormTasks = formCategory ? (tasksByCategory[formCategory] || []) : taskDefs;

  // === Dashboard calculations ===

  // Total required minutes from all tasks
  const totalRequiredMinutes = tasks.reduce((s, t) => s + t.plannedMinutes, 0);

  // Available resource from shifts for this date
  const shiftsForDate = getShifts().filter(s => s.date === selectedDate);
  const availableResourceMinutes = shiftsForDate.reduce((sum, s) => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    return sum + (eh * 60 + em - sh * 60 - sm);
  }, 0);

  // Actual total
  const totalActualMinutes = tasks.reduce((s, t) => s + t.actualMinutes, 0);

  // 画像査定 stats
  const imageAssessmentTasks = tasks.filter(t => t.taskName === '【LINE】画像査定');
  const imageAssessmentPlannedPoints = imageAssessmentTasks.reduce((s, t) => s + t.plannedCount, 0);
  const imageAssessmentActualPoints = imageAssessmentTasks.reduce((s, t) => s + t.actualPoints, 0);

  // 実査定 stats
  const assessmentTaskNames = ['【査定】計算書作成', '【査定】計算書提出', '【査定】両日提出', '【査定】計算書確認', '【査定】計算書（下書き）', '【査定】計算書修正', '【査定】再提出'];
  const assessmentTasks = tasks.filter(t => assessmentTaskNames.includes(t.taskName));
  const assessmentActualCount = assessmentTasks.reduce((s, t) => s + t.actualCount, 0);
  const assessmentActualPoints = assessmentTasks.reduce((s, t) => s + t.actualPoints, 0);

  // Per-member summary for actuals tab
  const memberActualSummary = members.map(m => {
    const memberTasks = tasks.filter(t => t.assigneeId === m.id);
    return {
      member: m,
      taskCount: memberTasks.length,
      totalActualMinutes: memberTasks.reduce((s, t) => s + t.actualMinutes, 0),
      totalActualCount: memberTasks.reduce((s, t) => s + t.actualCount, 0),
      totalActualPoints: memberTasks.reduce((s, t) => s + t.actualPoints, 0),
      completedCount: memberTasks.filter(t => t.status === 'completed').length,
    };
  }).filter(m => m.taskCount > 0);

  // Resource balance
  const resourceBalance = availableResourceMinutes - totalRequiredMinutes;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">日次業務入力</h1>
          <div className="flex items-center gap-3">
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
            <button onClick={() => setShowForm(true)} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">+ タスク追加</button>
            <button onClick={handleExportCSV} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">CSV出力</button>
          </div>
        </div>

        {/* Dashboard cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white rounded-lg px-4 py-3 border border-green-200 shadow-sm">
            <span className="text-xs text-green-600">本日のリソース</span>
            <p className="text-lg font-bold text-green-700">{availableResourceMinutes}分 ({(availableResourceMinutes / 60).toFixed(1)}h)</p>
            <p className="text-[10px] text-gray-400">{shiftsForDate.length}名出勤</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-orange-200 shadow-sm">
            <span className="text-xs text-orange-600">必要時間合計</span>
            <p className="text-lg font-bold text-orange-700">{totalRequiredMinutes}分 ({(totalRequiredMinutes / 60).toFixed(1)}h)</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 shadow-sm">
            <span className="text-xs text-gray-500">リソース差分</span>
            <p className={`text-lg font-bold ${resourceBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {resourceBalance >= 0 ? '+' : ''}{resourceBalance}分
            </p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-blue-200 shadow-sm">
            <span className="text-xs text-blue-600">実績合計</span>
            <p className="text-lg font-bold text-blue-700">{totalActualMinutes}分 ({(totalActualMinutes / 60).toFixed(1)}h)</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-purple-200 shadow-sm">
            <span className="text-xs text-purple-600">画像査定</span>
            <p className="text-sm font-bold text-purple-700">予定: {imageAssessmentPlannedPoints}点</p>
            <p className="text-sm font-bold text-purple-700">実績: {imageAssessmentActualPoints}点</p>
          </div>
          <div className="bg-white rounded-lg px-4 py-3 border border-rose-200 shadow-sm">
            <span className="text-xs text-rose-600">実査定</span>
            <p className="text-sm font-bold text-rose-700">件数: {assessmentActualCount}件</p>
            <p className="text-sm font-bold text-rose-700">点数: {assessmentActualPoints}点</p>
          </div>
        </div>

        {/* Auto-sync notice */}
        {tasks.some(t => t.comment === '月次予定から自動反映') && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700">
            月次カレンダーの予定が自動反映されています
          </div>
        )}

        {/* Add Task Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-md border border-green-200 p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4">新規タスク追加</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">カテゴリ</label>
                <select value={formCategory} onChange={e => handleCategoryChange(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">全カテゴリ</option>
                  {TASK_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">業務名</label>
                <select value={formTask} onChange={e => handleTaskSelect(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">選択してください</option>
                  {formCategory ? (
                    filteredFormTasks.map(t => <option key={t.id} value={t.name}>{t.name.replace(/^【[^】]+】/, '')}</option>)
                  ) : (
                    TASK_CATEGORIES.map(cat => {
                      const catTasks = tasksByCategory[cat] || [];
                      if (catTasks.length === 0) return null;
                      return (
                        <optgroup key={cat} label={cat}>
                          {catTasks.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </optgroup>
                      );
                    })
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">担当者</label>
                <select value={formAssignee} onChange={e => setFormAssignee(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">未割当</option>
                  <optgroup label="社員">
                    {members.filter(m => m.role === 'employee').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                  <optgroup label="アルバイト">
                    {members.filter(m => m.role === 'parttime').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">必要件数/点数/回数</label>
                <input type="number" value={formRequiredCount} onChange={e => setFormRequiredCount(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">1回あたりの時間（分）</label>
                <input type="number" value={formMinutesPerUnit} onChange={e => setFormMinutesPerUnit(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm" min={0} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">必要時間（分）</label>
                <div className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-bold">
                  {formRequiredCount * formMinutesPerUnit}分
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">キャンセル</button>
              <button onClick={handleAddTask} disabled={!formTask} className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">追加</button>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setViewTab('plan')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'plan' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >予定入力</button>
          <button
            onClick={() => setViewTab('actual')}
            className={`px-6 py-2 text-sm font-semibold border-b-2 transition-colors ${
              viewTab === 'actual' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >実績入力・集計</button>
        </div>

        {/* Plan Tab */}
        {viewTab === 'plan' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-green-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">業務名</th>
                    <th className="px-4 py-3 font-semibold">必要件数/点数/回数</th>
                    <th className="px-4 py-3 font-semibold">1回あたりの時間(分)</th>
                    <th className="px-4 py-3 font-semibold">必要時間(分)</th>
                    <th className="px-4 py-3 font-semibold">担当者</th>
                    <th className="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">タスクがありません。「+ タスク追加」から追加してください。</td></tr>
                  ) : (
                    tasks.map(t => {
                      const isFromMonthly = t.comment === '月次予定から自動反映';
                      return (
                        <tr key={t.id} className={`border-b border-gray-50 hover:bg-green-50/30 ${isFromMonthly ? 'bg-blue-50/30' : ''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800">
                            <span className="text-xs">{t.taskName}</span>
                            {isFromMonthly && <span className="ml-1 text-[10px] text-blue-500">(月次)</span>}
                          </td>
                          <td className="px-4 py-3">
                            <input type="number" value={t.plannedCount} onChange={e => handleUpdateField(t.id, 'plannedCount', Number(e.target.value))} className="w-20 border rounded px-2 py-1 text-sm" min={0} />
                          </td>
                          <td className="px-4 py-3">
                            <input type="number" value={t.minutesPerUnit || 0} onChange={e => handleUpdateField(t.id, 'minutesPerUnit', Number(e.target.value))} className="w-20 border rounded px-2 py-1 text-sm" min={0} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-bold text-orange-700">{t.plannedMinutes}分</span>
                          </td>
                          <td className="px-4 py-3">
                            <select value={t.assigneeId} onChange={e => handleUpdateField(t.id, 'assigneeId', e.target.value)} className="border rounded px-2 py-1 text-sm w-24">
                              <option value="">未割当</option>
                              <optgroup label="社員">
                                {members.filter(m => m.role === 'employee').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </optgroup>
                              <optgroup label="アルバイト">
                                {members.filter(m => m.role === 'parttime').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </optgroup>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => handleDeleteTask(t.id)} className="text-red-400 hover:text-red-600 text-xs">削除</button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  {tasks.length > 0 && (
                    <tr className="bg-orange-50 font-bold">
                      <td className="px-4 py-3 text-gray-700">合計</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-orange-700">{totalRequiredMinutes}分 ({(totalRequiredMinutes / 60).toFixed(1)}h)</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actual Tab */}
        {viewTab === 'actual' && (
          <div className="space-y-4">
            {/* Per-member summary cards */}
            {memberActualSummary.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {memberActualSummary.map(ms => (
                  <div key={ms.member.id} className="bg-white rounded-lg px-4 py-3 border border-gray-100 shadow-sm">
                    <p className="text-xs text-gray-500">{ms.member.name}</p>
                    <p className="text-sm font-bold text-gray-800">{ms.totalActualMinutes}分 / {ms.totalActualCount}件</p>
                    <p className="text-xs text-gray-400">{ms.completedCount}/{ms.taskCount} 完了</p>
                  </div>
                ))}
              </div>
            )}

            {/* Actuals table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">業務名</th>
                      <th className="px-4 py-3 font-semibold">担当者</th>
                      <th className="px-4 py-3 font-semibold">予定</th>
                      <th className="px-4 py-3 font-semibold">実績件数</th>
                      <th className="px-4 py-3 font-semibold">実績点数</th>
                      <th className="px-4 py-3 font-semibold">実績時間(分)</th>
                      <th className="px-4 py-3 font-semibold">状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">タスクがありません</td></tr>
                    ) : (
                      tasks.map(t => {
                        const member = members.find(m => m.id === t.assigneeId);
                        return (
                          <tr key={t.id} className="border-b border-gray-50 hover:bg-blue-50/30">
                            <td className="px-4 py-3 font-medium text-gray-800 text-xs">{t.taskName}</td>
                            <td className="px-4 py-3 text-gray-600 text-xs">{member?.name || <span className="text-gray-400">未割当</span>}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">{t.plannedCount}回 / {t.plannedMinutes}分</td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualCount} onChange={e => handleUpdateField(t.id, 'actualCount', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualPoints} onChange={e => handleUpdateField(t.id, 'actualPoints', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <input type="number" value={t.actualMinutes} onChange={e => handleUpdateField(t.id, 'actualMinutes', Number(e.target.value))} className="w-16 border rounded px-2 py-1 text-sm" min={0} />
                            </td>
                            <td className="px-4 py-3">
                              <select value={t.status} onChange={e => handleUpdateField(t.id, 'status', e.target.value)}
                                className={`text-xs rounded-full px-2 py-1 font-medium border-0 ${
                                  t.status === 'completed' ? 'bg-green-100 text-green-700' :
                                  t.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                <option value="pending">未着手</option>
                                <option value="in_progress">進行中</option>
                                <option value="completed">完了</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {tasks.length > 0 && (
                      <tr className="bg-blue-50 font-bold">
                        <td className="px-4 py-3 text-gray-700">合計</td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-blue-700">{tasks.reduce((s, t) => s + t.actualCount, 0)}</td>
                        <td className="px-4 py-3 text-blue-700">{tasks.reduce((s, t) => s + t.actualPoints, 0)}</td>
                        <td className="px-4 py-3 text-blue-700">{totalActualMinutes}分</td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Timeline */}
        {tasks.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-600 mb-4">タイムライン表示（予定）</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-40" />
                <div className="flex-1 flex">
                  {Array.from({ length: 14 }, (_, i) => (
                    <div key={i} className="flex-1 text-xs text-gray-400 text-center">{8 + i}:00</div>
                  ))}
                </div>
              </div>
              {/* Group tasks by assignee and show as timeline blocks */}
              {(() => {
                // Group tasks by assignee
                const assigneeGroups: Record<string, DailyTask[]> = {};
                tasks.forEach(t => {
                  const key = t.assigneeId || '__unassigned__';
                  if (!assigneeGroups[key]) assigneeGroups[key] = [];
                  assigneeGroups[key].push(t);
                });

                return Object.entries(assigneeGroups).map(([assigneeId, assigneeTasks]) => {
                  const member = members.find(m => m.id === assigneeId);
                  const memberName = member?.name || '未割当';
                  // Get shift for this member to determine start time
                  const shift = shiftsForDate.find(s => s.memberId === assigneeId);
                  const shiftStartMinutes = shift
                    ? (parseInt(shift.startTime.split(':')[0]) - 8) * 60 + parseInt(shift.startTime.split(':')[1])
                    : 60; // default 9:00

                  let currentOffset = shiftStartMinutes;
                  const totalMinutes = 14 * 60; // 8:00 - 22:00

                  return assigneeTasks.map((t, idx) => {
                    const left = Math.max(0, (currentOffset / totalMinutes) * 100);
                    const duration = t.plannedMinutes || 30;
                    const width = Math.max(1, (duration / totalMinutes) * 100);
                    currentOffset += duration;

                    return (
                      <div key={t.id} className="flex items-center gap-2">
                        <div className="w-40 text-xs text-gray-600 text-right truncate">
                          {idx === 0 ? memberName + ': ' : ''}
                          {t.taskName.replace(/^【[^】]+】/, '')}
                        </div>
                        <div className="flex-1 bg-gray-100 rounded h-6 relative">
                          <div
                            className={`absolute h-full rounded text-[8px] text-white flex items-center justify-center overflow-hidden ${
                              t.status === 'completed' ? 'bg-green-500' :
                              t.status === 'in_progress' ? 'bg-yellow-500' :
                              'bg-blue-400'
                            }`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${t.taskName} (${t.plannedMinutes}分)`}
                          >
                            {t.plannedMinutes > 20 ? `${t.plannedMinutes}分` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  });
                });
              })()}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
