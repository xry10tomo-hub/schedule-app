'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { useAppContext, getMembers, setMembers, getTaskDefinitions, DEFAULT_MEMBERS, DEFAULT_TASKS, TASK_CATEGORIES } from '@/lib/store';
import type { Member, TaskDefinition } from '@/lib/types';

export default function MembersPage() {
  const { refreshMembers, dataVersion } = useAppContext();
  const [membersList, setMembersList] = useState<Member[]>(DEFAULT_MEMBERS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSkills, setEditSkills] = useState<string[]>([]);
  const [editSpeeds, setEditSpeeds] = useState<Record<string, number>>({});
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>(DEFAULT_TASKS);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [matrixCategory, setMatrixCategory] = useState<string>(TASK_CATEGORIES[0]);

  useEffect(() => {
    setMembersList(getMembers());
    setTaskDefs(getTaskDefinitions());
  }, [dataVersion]);

  const tasksByCategory = TASK_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = taskDefs.filter(t => t.category === cat);
    return acc;
  }, {} as Record<string, TaskDefinition[]>);

  function startEdit(member: Member) {
    setEditingId(member.id);
    setEditSkills([...member.skills]);
    setEditSpeeds({ ...member.speedRatings });
    setOpenCategories({});
  }

  function saveEdit(memberId: string) {
    const updated = getMembers().map(m => {
      if (m.id !== memberId) return m;
      return { ...m, skills: editSkills, speedRatings: editSpeeds };
    });
    setMembers(updated);
    setMembersList(updated);
    refreshMembers();
    setEditingId(null);
  }

  function toggleSkill(skill: string) {
    if (editSkills.includes(skill)) {
      setEditSkills(editSkills.filter(s => s !== skill));
      const newSpeeds = { ...editSpeeds };
      delete newSpeeds[skill];
      setEditSpeeds(newSpeeds);
    } else {
      setEditSkills([...editSkills, skill]);
      // Don't auto-set speed - leave it optional
    }
  }

  function toggleCategory(cat: string) {
    setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  }

  function selectAllInCategory(cat: string) {
    const tasksInCat = tasksByCategory[cat] || [];
    const allSelected = tasksInCat.every(t => editSkills.includes(t.name));
    if (allSelected) {
      const names = tasksInCat.map(t => t.name);
      setEditSkills(editSkills.filter(s => !names.includes(s)));
      const newSpeeds = { ...editSpeeds };
      names.forEach(n => delete newSpeeds[n]);
      setEditSpeeds(newSpeeds);
    } else {
      const newSkills = [...editSkills];
      tasksInCat.forEach(t => {
        if (!newSkills.includes(t.name)) newSkills.push(t.name);
      });
      setEditSkills(newSkills);
    }
  }

  const employees = membersList.filter(m => m.role === 'employee');
  const parttimers = membersList.filter(m => m.role === 'parttime');

  function MemberCard({ member }: { member: Member }) {
    const isEditing = editingId === member.id;
    const skillsByCategory = TASK_CATEGORIES.reduce((acc, cat) => {
      const skills = member.skills.filter(s => {
        const td = taskDefs.find(t => t.name === s);
        return td?.category === cat;
      });
      if (skills.length > 0) acc[cat] = skills;
      return acc;
    }, {} as Record<string, string[]>);

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-fade-in">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${
              member.role === 'employee' ? 'bg-green-600' : 'bg-blue-600'
            }`}>{member.name.charAt(0)}</div>
            <div>
              <h3 className="font-bold text-gray-800">{member.name}</h3>
              <div className="flex gap-1 mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  member.role === 'employee' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                }`}>{member.role === 'employee' ? '社員' : 'アルバイト'}</span>
                {member.isAdmin && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">管理者</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{member.skills.length}業務</span>
            {isEditing ? (
              <div className="flex gap-2">
                <button onClick={() => saveEdit(member.id)} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">保存</button>
                <button onClick={() => setEditingId(null)} className="text-xs bg-gray-200 text-gray-600 px-3 py-1 rounded-lg hover:bg-gray-300">取消</button>
              </div>
            ) : (
              <button onClick={() => startEdit(member)} className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded-lg hover:bg-green-100">編集</button>
            )}
          </div>
        </div>

        <div className="mt-3">
          <p className="text-xs font-semibold text-gray-500 mb-2">対応可能業務{isEditing ? '' : ' & スピード（分/件・任意）'}</p>
          {isEditing ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {TASK_CATEGORIES.map(cat => {
                const catTasks = tasksByCategory[cat] || [];
                if (catTasks.length === 0) return null;
                const isOpen = openCategories[cat];
                const selectedCount = catTasks.filter(t => editSkills.includes(t.name)).length;
                return (
                  <div key={cat} className="border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer" onClick={() => toggleCategory(cat)}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-700">{cat}</span>
                        <span className="text-xs text-gray-400">({selectedCount}/{catTasks.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={e => { e.stopPropagation(); selectAllInCategory(cat); }} className="text-xs text-blue-600 hover:underline">
                          {selectedCount === catTasks.length ? '全解除' : '全選択'}
                        </button>
                        <span className="text-gray-400">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="p-2 space-y-1">
                        {catTasks.map(td => {
                          const isActive = editSkills.includes(td.name);
                          return (
                            <div key={td.id} className="flex items-center gap-2">
                              <button
                                onClick={() => toggleSkill(td.name)}
                                className={`flex-1 text-left px-2 py-1 rounded text-xs font-medium transition-colors ${
                                  isActive ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-gray-50 text-gray-400 border border-gray-200'
                                }`}
                              >{td.name.replace(/^【[^】]+】/, '')}</button>
                              {isActive && (
                                <input
                                  type="number"
                                  value={editSpeeds[td.name] ?? ''}
                                  onChange={e => {
                                    const val = e.target.value;
                                    if (val === '') {
                                      const newSpeeds = { ...editSpeeds };
                                      delete newSpeeds[td.name];
                                      setEditSpeeds(newSpeeds);
                                    } else {
                                      setEditSpeeds({ ...editSpeeds, [td.name]: Number(val) });
                                    }
                                  }}
                                  placeholder="-"
                                  className="w-14 border rounded px-1 py-1 text-xs text-center"
                                  min={0}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {Object.entries(skillsByCategory).map(([cat, skills]) => (
                <div key={cat}>
                  <span className="text-xs font-bold text-gray-500">{cat}: </span>
                  {skills.map(skill => (
                    <span key={skill} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs mr-1 mb-1">
                      {skill.replace(/^【[^】]+】/, '')}
                      {member.speedRatings[skill] != null && (
                        <span className="text-green-400">({member.speedRatings[skill]}分)</span>
                      )}
                    </span>
                  ))}
                </div>
              ))}
              {member.skills.length === 0 && <span className="text-xs text-gray-400">未設定（編集ボタンから業務を追加してください）</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  const matrixTasks = tasksByCategory[matrixCategory] || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">業務及びメンバー管理</h1>

        {/* Employees */}
        <div>
          <h2 className="text-lg font-bold text-green-700 mb-3 flex items-center gap-2">
            <span className="w-3 h-3 bg-green-500 rounded-full" />社員 ({employees.length}名)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {employees.map(m => <MemberCard key={m.id} member={m} />)}
          </div>
        </div>

        {/* Part-timers */}
        <div>
          <h2 className="text-lg font-bold text-blue-700 mb-3 flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-500 rounded-full" />アルバイト ({parttimers.length}名)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {parttimers.map(m => <MemberCard key={m.id} member={m} />)}
          </div>
        </div>

        {/* Skill Matrix */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <h3 className="text-lg font-bold text-gray-800">スキルマトリックス</h3>
            <select value={matrixCategory} onChange={e => setMatrixCategory(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
              {TASK_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4 font-medium sticky left-0 bg-white z-10">メンバー</th>
                  {matrixTasks.map(td => (
                    <th key={td.id} className="pb-2 px-2 text-center font-medium text-xs whitespace-nowrap">{td.name.replace(/^【[^】]+】/, '')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {membersList.map(m => (
                  <tr key={m.id} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-medium text-gray-800 sticky left-0 bg-white z-10">{m.name}</td>
                    {matrixTasks.map(td => {
                      const hasSkill = m.skills.includes(td.name);
                      const speed = m.speedRatings[td.name];
                      return (
                        <td key={td.id} className="py-2 px-2 text-center">
                          {hasSkill ? (
                            <span className="inline-block w-8 h-8 leading-8 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                              {speed != null ? speed : '○'}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
