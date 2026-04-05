'use client';

import { createContext, useContext } from 'react';
import { db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';
import type {
  Member,
  DailyTask,
  MonthlySchedule,
  ShippingRecord,
  ShiftEntry,
  TaskDefinition,
  TaskResource,
} from './types';

// ============ Default Data ============

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'wada', name: '和田', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'ushioda', name: '潮田', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'kunigane', name: '国兼', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'kumagai', name: '熊谷', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'suzuki', name: '鈴木', role: 'employee', isAdmin: true, skills: [], speedRatings: {}, email: '' },
  { id: 'mihara', name: '三原', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'nakatani', name: '中谷', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'sato', name: '佐藤', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'ishii', name: '石井', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, email: '' },
  { id: 'kagami', name: '加々美', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, email: '' },
];

// Task categories for grouping in dropdowns
export const TASK_CATEGORIES = [
  'LINE', '営業', '査定', '販売', '社内', '売却', '補助', '配信', 'タグ', '集計データ更新', 'OL', 'その他',
] as const;

export const DEFAULT_TASKS: TaskDefinition[] = [
  // LINE
  { id: 'line-1', name: '【LINE】画像査定', category: 'LINE', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'line-2', name: '【LINE】LINE整理', category: 'LINE', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'line-3', name: '【LINE】要対応', category: 'LINE', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'line-4', name: '【LINE】商材追いLINE', category: 'LINE', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  // 営業
  { id: 'sales-1', name: '【営業】リスト作成', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sales-2', name: '【営業】電話番号登録', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 3 },
  { id: 'sales-3', name: '【営業】商材追い電話', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sales-4', name: '【営業】新規電話', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sales-5', name: '【営業】継続電話', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sales-6', name: '【営業】受け電話', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sales-7', name: '【営業】確認架電', category: '営業', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  // 査定
  { id: 'assess-1', name: '【査定】計算書作成', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'assess-2', name: '【査定】計算書提出', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'assess-3', name: '【査定】再提出', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'assess-4', name: '【査定】計算書（下書き）', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'assess-5', name: '【査定】計算書修正', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'assess-6', name: '【査定】マスター登録', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'assess-7', name: '【査定】両日提出', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'assess-8', name: '【査定】計算書確認', category: '査定', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  // 販売
  { id: 'sell-1', name: '【販売】オークション準備', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-2', name: '【販売】オークション返送分処理', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-3', name: '【販売】梱包', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-4', name: '【販売】結果共有', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sell-5', name: '【販売】AVE作成', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-6', name: '【販売】エメパス製品化', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-7', name: '【販売】在庫管理（卸先・Y出し選定）', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-8', name: '【販売】差別・鑑定依頼', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-9', name: '【販売】アプレ返却対応', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-10', name: '【販売】計算書転記', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-11', name: '【販売】シッピング', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-12', name: '【販売】バク成約・上がり', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-13', name: '【販売】高橋買取依頼・上がり', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-14', name: '【販売】アクヒリ一製品化', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-15', name: '【販売】NJ予約電話', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sell-16', name: '【販売】在庫管理（製品登録）', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-17', name: '【販売】タグ付け（オークション）', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sell-18', name: '【販売】製品洗浄', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-19', name: '【販売】ルース分け', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-20', name: '【販売】オークションリスト作成', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-21', name: '【販売】リスト送付（オークション）', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'sell-22', name: '【販売】アプレ製品売却準備', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-23', name: '【販売】製品下見', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-24', name: '【販売】ソーティング戻り入力', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-25', name: '【販売】RELE請求', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-26', name: '【販売】AVE請求', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-27', name: '【販売】明細確認・交渉', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  // 社内
  { id: 'internal-1', name: '【社内】ミーティング準備', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'internal-2', name: '【社内】ミーティング', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'internal-3', name: '【社内】全体会議', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 60 },
  { id: 'internal-4', name: '【社内】問題解決', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'internal-5', name: '【社内】業務改善', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'internal-6', name: '【社内】マニュアル作成', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'internal-7', name: '【社内】PJ準備', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'internal-8', name: '【社内】PJ審査・フィードバック', category: '社内', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  // 売却
  { id: 'dispose-1', name: '【売却】承諾確認・催促', category: '売却', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'dispose-2', name: '【売却】潰し分け', category: '売却', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'dispose-3', name: '【売却】潰し', category: '売却', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'dispose-4', name: '【売却】売却準備', category: '売却', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  // 補助
  { id: 'assist-1', name: '【補助】郵送物開封', category: '補助', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  { id: 'assist-2', name: '【補助】返送', category: '補助', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'assist-3', name: '【補助】相場更新', category: '補助', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'assist-4', name: '【補助】ファイル移動', category: '補助', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 5 },
  // 配信
  { id: 'delivery-1', name: '【配信】エメパス配信・毎月1日', category: '配信', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'delivery-2', name: '【配信】エメパス配信・中旬', category: '配信', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'delivery-3', name: '【配信】エメパス配信・月末', category: '配信', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  // タグ
  { id: 'tag-1', name: '【タグ】エメパスタグ付け', category: 'タグ', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'tag-2', name: '【タグ】画像査定優先タグ付け', category: 'タグ', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  // 集計データ更新
  { id: 'data-1', name: '【集計データ更新】集計', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'data-2', name: '【集計データ更新】3階層作成表', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'data-3', name: '【集計データ更新】在庫管理シート', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'data-4', name: '【集計データ更新】画像査定シート', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'data-5', name: '【集計データ更新】袋数メンテナンス', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'data-6', name: '【集計データ更新】計算書マスター', category: '集計データ更新', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  // OL
  { id: 'ol-1', name: '【OL】進捗確認', category: 'OL', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'ol-2', name: '【OL】スケジュール作成', category: 'OL', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  // その他
  { id: 'other-1', name: '【その他】備品管理集計', category: 'その他', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'other-2', name: '【他】休憩', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 60 },
  { id: 'other-3', name: '【その他】有休', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 480 },
  { id: 'other-4', name: '【その他】移動', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 30 },
  { id: 'other-5', name: '【その他】外回り', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 120 },
  { id: 'other-6', name: '【その他】引越', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 120 },
  { id: 'other-7', name: '【その他】教育', category: 'その他', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 30 },
  { id: 'other-8', name: '【その他】ゴミ捨て', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 10 },
  { id: 'other-9', name: '【他】掃除', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 15 },
  { id: 'other-10', name: '【その他】メルバー確認', category: 'その他', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'other-11', name: '【その他】日報', category: 'その他', defaultPointsPerUnit: 0, estimatedMinutesPerUnit: 10 },
];

// ============ Fixed Tasks (固定業務) ============
// When '固定業務' is selected in monthly calendar, these tasks auto-populate daily
export const FIXED_TASK_NAMES = [
  '【LINE】画像査定',
  '【LINE】LINE整理',
  '【LINE】要対応',
  '【LINE】商材追いLINE',
  '【査定】計算書作成',
  '【査定】計算書提出',
  '【査定】計算書（下書き）',
  '【社内】ミーティング',
  '【売却】承諾確認・催促',
  '【売却】潰し分け',
  '【売却】潰し',
  '【売却】売却準備',
  '【補助】郵送物開封',
  '【補助】返送',
  '【補助】相場更新',
  '【OL】進捗確認',
  '【OL】スケジュール作成',
  '【他】休憩',
];

// ============ Default Task Resources (1点あたりのリソース) ============
export const DEFAULT_TASK_RESOURCES: TaskResource[] = [
  { taskName: '【LINE】画像査定', minutesPerPoint: 5 },
  { taskName: '【LINE】LINE整理', minutesPerPoint: 5 },
  { taskName: '【LINE】要対応', minutesPerPoint: 10 },
  { taskName: '【LINE】商材追いLINE', minutesPerPoint: 5 },
  { taskName: '【査定】計算書作成', minutesPerPoint: 15 },
  { taskName: '【査定】計算書提出', minutesPerPoint: 5 },
  { taskName: '【査定】両日提出', minutesPerPoint: 10 },
  { taskName: '【査定】計算書確認', minutesPerPoint: 10 },
  { taskName: '【査定】計算書（下書き）', minutesPerPoint: 10 },
  { taskName: '【補助】郵送物開封', minutesPerPoint: 5 },
  { taskName: '【補助】返送', minutesPerPoint: 10 },
  { taskName: '【補助】相場更新', minutesPerPoint: 15 },
  { taskName: '【補助】ファイル移動', minutesPerPoint: 5 },
  { taskName: '【売却】承諾確認・催促', minutesPerPoint: 10 },
  { taskName: '【売却】潰し分け', minutesPerPoint: 10 },
  { taskName: '【売却】潰し', minutesPerPoint: 15 },
  { taskName: '【売却】売却準備', minutesPerPoint: 10 },
  { taskName: '【他】休憩', minutesPerPoint: 60 },
  { taskName: '【他】掃除', minutesPerPoint: 15 },
  { taskName: '【OL】スケジュール作成', minutesPerPoint: 15 },
  { taskName: '【OL】進捗確認', minutesPerPoint: 10 },
  { taskName: '【社内】ミーティング', minutesPerPoint: 30 },
  { taskName: '【販売】RELE請求', minutesPerPoint: 10 },
  { taskName: '【販売】AVE請求', minutesPerPoint: 10 },
  { taskName: '【販売】明細確認・交渉', minutesPerPoint: 15 },
];

// ============ LocalStorage helpers ============

export const STORAGE_KEYS = {
  members: 'schedule_members',
  dailyTasks: 'schedule_daily_tasks',
  monthlySchedules: 'schedule_monthly',
  shippingRecords: 'schedule_shipping',
  shifts: 'schedule_shifts',
  tasks: 'schedule_task_defs',
  currentUser: 'schedule_current_user',
  taskResources: 'schedule_task_resources',
} as const;

// Keys to sync with Firestore (currentUser is per-device, not synced)
export const SYNC_KEYS: Set<string> = new Set([
  STORAGE_KEYS.members,
  STORAGE_KEYS.dailyTasks,
  STORAGE_KEYS.monthlySchedules,
  STORAGE_KEYS.shippingRecords,
  STORAGE_KEYS.shifts,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.taskResources,
]);

function getFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
  // Sync to Firestore for shared data
  if (SYNC_KEYS.has(key)) {
    setDoc(doc(db, 'appData', key), {
      value: JSON.parse(JSON.stringify(value)),
      updatedAt: Date.now(),
    }).catch((err) => console.error('Firestore sync error:', err));
  }
}

// ============ Data Access Functions ============

export function getMembers(): Member[] {
  return getFromStorage(STORAGE_KEYS.members, DEFAULT_MEMBERS);
}
export function setMembers(members: Member[]) {
  setToStorage(STORAGE_KEYS.members, members);
}

export function getDailyTasks(): DailyTask[] {
  return getFromStorage(STORAGE_KEYS.dailyTasks, []);
}
export function setDailyTasks(tasks: DailyTask[]) {
  setToStorage(STORAGE_KEYS.dailyTasks, tasks);
}

export function getMonthlySchedules(): MonthlySchedule[] {
  return getFromStorage(STORAGE_KEYS.monthlySchedules, []);
}
export function setMonthlySchedules(schedules: MonthlySchedule[]) {
  setToStorage(STORAGE_KEYS.monthlySchedules, schedules);
}

export function getShippingRecords(): ShippingRecord[] {
  return getFromStorage(STORAGE_KEYS.shippingRecords, []);
}
export function setShippingRecords(records: ShippingRecord[]) {
  setToStorage(STORAGE_KEYS.shippingRecords, records);
}

export function getShifts(): ShiftEntry[] {
  return getFromStorage(STORAGE_KEYS.shifts, []);
}
export function setShifts(shifts: ShiftEntry[]) {
  setToStorage(STORAGE_KEYS.shifts, shifts);
}

export function getTaskDefinitions(): TaskDefinition[] {
  return getFromStorage(STORAGE_KEYS.tasks, DEFAULT_TASKS);
}
export function setTaskDefinitions(tasks: TaskDefinition[]) {
  setToStorage(STORAGE_KEYS.tasks, tasks);
}

export function getTaskResources(): TaskResource[] {
  return getFromStorage(STORAGE_KEYS.taskResources, DEFAULT_TASK_RESOURCES);
}
export function setTaskResources(resources: TaskResource[]) {
  setToStorage(STORAGE_KEYS.taskResources, resources);
}

export function getCurrentUser(): string {
  return getFromStorage(STORAGE_KEYS.currentUser, '');
}
export function setCurrentUser(userId: string) {
  setToStorage(STORAGE_KEYS.currentUser, userId);
}

// ============ Helper Utilities ============

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getToday(): string {
  return formatDate(new Date());
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getMemberById(id: string): Member | undefined {
  return getMembers().find(m => m.id === id);
}

// ============ CSV Export ============

export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(',')
    ),
  ];
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ Summary Calculations ============

export function calculateDailySummary(date: string): {
  totalPlannedMinutes: number;
  totalActualMinutes: number;
  totalPlannedPoints: number;
  totalActualPoints: number;
  completionRate: number;
  gapMinutes: number;
  taskCount: number;
  completedCount: number;
} {
  const tasks = getDailyTasks().filter(t => t.date === date);
  const totalPlannedMinutes = tasks.reduce((s, t) => s + t.plannedMinutes, 0);
  const totalActualMinutes = tasks.reduce((s, t) => s + t.actualMinutes, 0);
  const totalPlannedPoints = tasks.reduce((s, t) => s + t.plannedPoints, 0);
  const totalActualPoints = tasks.reduce((s, t) => s + t.actualPoints, 0);
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  return {
    totalPlannedMinutes,
    totalActualMinutes,
    totalPlannedPoints,
    totalActualPoints,
    completionRate: tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0,
    gapMinutes: totalActualMinutes - totalPlannedMinutes,
    taskCount: tasks.length,
    completedCount,
  };
}

export function calculateMemberSummary(memberId: string, startDate: string, endDate: string) {
  const tasks = getDailyTasks().filter(
    t => t.assigneeId === memberId && t.date >= startDate && t.date <= endDate
  );
  const totalPlannedMinutes = tasks.reduce((s, t) => s + t.plannedMinutes, 0);
  const totalActualMinutes = tasks.reduce((s, t) => s + t.actualMinutes, 0);
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  return {
    totalPlannedMinutes,
    totalActualMinutes,
    totalTasks: tasks.length,
    completedTasks,
    efficiency: totalPlannedMinutes > 0 ? totalActualMinutes / totalPlannedMinutes : 0,
  };
}

// ============ Context for current user ============

export interface AppContextType {
  currentUserId: string;
  setCurrentUserId: (id: string) => void;
  members: Member[];
  refreshMembers: () => void;
  dataVersion: number; // increments on remote Firestore updates
  firestoreReady: boolean;
}

export const AppContext = createContext<AppContextType>({
  currentUserId: '',
  setCurrentUserId: () => {},
  members: DEFAULT_MEMBERS,
  refreshMembers: () => {},
  dataVersion: 0,
  firestoreReady: false,
});

export function useAppContext() {
  return useContext(AppContext);
}
