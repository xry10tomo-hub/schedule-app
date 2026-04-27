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
  HandoverRequest,
} from './types';

// ============ Default Data ============

export const DEFAULT_MEMBERS: Member[] = [
  { id: 'wada', name: '和田', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'ushioda', name: '潮田', role: 'employee', isAdmin: true, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'kunigane', name: '国兼', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'kumagai', name: '熊谷', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'suzuki', name: '鈴木', role: 'employee', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'mihara', name: '三原', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'nakatani', name: '中谷', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'sato', name: '佐藤', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'ishii', name: '石井', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
  { id: 'kagami', name: '加々美', role: 'parttime', isAdmin: false, skills: [], speedRatings: {}, priorityRatings: {}, scheduledTimeRatings: {}, email: '' },
];

// Task categories for grouping in dropdowns
export const TASK_CATEGORIES = [
  'LINE', '営業', '査定', '販売', '社内', '売却', '補助', '配信', 'タグ', '集計データ更新', 'OL', 'その他',
] as const;

// Category-based color mapping
// Each category has multiple shades so tasks within the same category are distinguishable
export const CATEGORY_COLORS: Record<string, string[]> = {
  'LINE':           ['#16a34a', '#22c55e', '#4ade80', '#15803d'],  // 緑系
  '営業':           ['#ea580c', '#f97316', '#fb923c', '#c2410c'],  // オレンジ系
  '査定':           ['#1e3a5f', '#93c5fd', '#1d4ed8', '#bfdbfe', '#2563eb', '#dbeafe', '#3b82f6', '#60a5fa'],  // 青系（濃淡交互）
  '販売':           ['#dc2626', '#ef4444', '#f87171', '#b91c1c', '#fca5a5', '#991b1b', '#f43f5e', '#e11d48', '#fb7185', '#be123c', '#fda4af', '#9f1239', '#e879a4', '#c026d3', '#a855f7', '#d946ef', '#db2777', '#ec4899', '#f472b6', '#be185d', '#a21caf', '#7c3aed', '#6d28d9', '#8b5cf6', '#c084fc', '#a78bfa', '#7e22ce'],  // 赤系 (many shades for many tasks)
  '社内':           ['#6b7280', '#9ca3af', '#4b5563', '#d1d5db', '#374151', '#a8a29e', '#78716c', '#57534e'],  // グレー系
  '売却':           ['#7c3aed', '#8b5cf6', '#a78bfa', '#6d28d9'],  // 紫系
  '補助':           ['#ca8a04', '#eab308', '#facc15', '#a16207'],  // 黄色系
  '配信':           ['#0d9488', '#14b8a6', '#2dd4bf', '#0f766e'],  // ティール系
  'タグ':           ['#be185d', '#ec4899', '#f472b6', '#9d174d'],  // ピンク系
  '集計データ更新':  ['#4338ca', '#6366f1', '#818cf8', '#3730a3', '#a5b4fc', '#312e81'],  // インディゴ系
  'OL':             ['#0e7490', '#06b6d4', '#22d3ee', '#155e75'],  // シアン系
  'その他':         ['#78716c', '#a8a29e', '#d6d3d1', '#57534e', '#44403c', '#292524', '#e7e5e4', '#8d8680', '#b8b3ad', '#a3a099', '#c4bfb9'],  // 石系（ウォームグレー）
};

// Get color for a task name based on its category
export function getCategoryTaskColor(taskName: string): string {
  const tasks = getTaskDefinitions();
  const task = tasks.find(t => t.name === taskName);
  const category = task?.category || 'その他';
  const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS['その他'];
  // Find index of this task within its category
  const categoryTasks = tasks.filter(t => t.category === category);
  const idx = categoryTasks.findIndex(t => t.name === taskName);
  return colors[Math.max(idx, 0) % colors.length];
}

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
  { id: 'sell-6', name: '【販売】エメキン製品化', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-7', name: '【販売】在庫管理（卸先・Y出し選定）', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-8', name: '【販売】差別・鑑定依頼', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-9', name: '【販売】アプレ返却対応', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-10', name: '【販売】計算書読込', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-11', name: '【販売】シッピング', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 15 },
  { id: 'sell-12', name: '【販売】バク成約・上がり', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-13', name: '【販売】高橋買取依頼・上がり', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
  { id: 'sell-14', name: '【販売】アクセサリー製品化', category: '販売', defaultPointsPerUnit: 1, estimatedMinutesPerUnit: 10 },
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
// Default list - can be overridden via getFixedTasks()/setFixedTasks() from UI
export const DEFAULT_FIXED_TASK_NAMES = [
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
  '【販売】明細確認・交渉',
  '【営業】商材追い電話',
  '【販売】AVE請求',
  '【営業】受け電話',
  '【他】休憩',
];

// Backwards-compat: always read from storage when accessed
export function getFixedTasks(): string[] {
  return getFromStorage('schedule_fixed_tasks', DEFAULT_FIXED_TASK_NAMES);
}
export function setFixedTasks(tasks: string[]) {
  setToStorage('schedule_fixed_tasks', tasks);
}
// Deprecated: use getFixedTasks() - kept for backwards compat where synchronous module-init access is safe
export const FIXED_TASK_NAMES = DEFAULT_FIXED_TASK_NAMES;

// Default values for fixed tasks (件数/点数/回数 and 1回あたり時間)
// Used when a fixed task is auto-populated via 月次カレンダー (applied every day the same)
export type FixedTaskDefault = { plannedCount: number; minutesPerUnit: number };
export function getFixedTaskDefaults(): Record<string, FixedTaskDefault> {
  return getFromStorage('schedule_fixed_task_defaults', {});
}
export function setFixedTaskDefaults(defaults: Record<string, FixedTaskDefault>) {
  setToStorage('schedule_fixed_task_defaults', defaults);
}

// Per-task assignment config (used by daily input + auto-assign)
// - assignableMemberIds: list of member ids who can do this task
// - scheduledStart / scheduledEnd: legacy single time range (kept for backwards compat)
// - scheduledRanges: multiple time ranges (new format)
export type ScheduledRange = { start: string; end: string };
export type TaskAssignmentConfig = {
  assignableMemberIds: string[];
  scheduledStart: string; // legacy
  scheduledEnd: string;   // legacy
  scheduledRanges?: ScheduledRange[]; // multiple time slots
};
export function getTaskAssignments(): Record<string, TaskAssignmentConfig> {
  const raw = getFromStorage<Record<string, TaskAssignmentConfig>>('schedule_task_assignments', {});
  // Migrate legacy single-range to scheduledRanges array if missing
  const out: Record<string, TaskAssignmentConfig> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v.scheduledRanges) {
      out[k] = {
        ...v,
        scheduledRanges: (v.scheduledStart && v.scheduledEnd) ? [{ start: v.scheduledStart, end: v.scheduledEnd }] : [],
      };
    } else {
      out[k] = v;
    }
  }
  return out;
}
export function setTaskAssignments(data: Record<string, TaskAssignmentConfig>) {
  setToStorage('schedule_task_assignments', data);
}

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
  timeline: 'schedule_timeline',
  actualTimeline: 'schedule_actual_timeline',
  handovers: 'schedule_handovers',
  actualPerformance: 'schedule_actual_performance',
  fixedTasks: 'schedule_fixed_tasks',
  fixedTaskDefaults: 'schedule_fixed_task_defaults',
  taskAssignments: 'schedule_task_assignments',
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
  STORAGE_KEYS.timeline,
  STORAGE_KEYS.actualTimeline,
  STORAGE_KEYS.handovers,
  STORAGE_KEYS.actualPerformance,
  STORAGE_KEYS.fixedTasks,
  STORAGE_KEYS.fixedTaskDefaults,
  STORAGE_KEYS.taskAssignments,
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

// Firestore sync readiness flag - blocks writes until initial Firestore data is loaded
let firestoreSyncReady = false;
const pendingWrites = new Map<string, unknown>();

export function setFirestoreSyncReady(ready: boolean) {
  firestoreSyncReady = ready;
  // Flush any pending writes that accumulated before Firestore was ready
  if (ready && pendingWrites.size > 0) {
    for (const [key, value] of pendingWrites) {
      debouncedFirestoreSync(key, value);
    }
    pendingWrites.clear();
  }
}

export function isFirestoreSyncReady(): boolean {
  return firestoreSyncReady;
}

// Debounce Firestore writes per key to prevent write-stream exhaustion
const firestoreTimers = new Map<string, ReturnType<typeof setTimeout>>();
function debouncedFirestoreSync(key: string, value: unknown) {
  const existing = firestoreTimers.get(key);
  if (existing) clearTimeout(existing);
  firestoreTimers.set(key, setTimeout(() => {
    firestoreTimers.delete(key);
    setDoc(doc(db, 'appData', key), {
      value: JSON.parse(JSON.stringify(value)),
      updatedAt: Date.now(),
    }).catch((err) => console.error('Firestore sync error:', err));
  }, 500));
}

// Undo history stack - captures previous values so Ctrl+Z can restore them
type UndoEntry = { key: string; prevValue: unknown; timestamp: number };
const undoStack: UndoEntry[] = [];
const MAX_UNDO_HISTORY = 50;
let suppressUndoCapture = false;
const undoListeners: Set<() => void> = new Set();

export function subscribeToUndo(listener: () => void): () => void {
  undoListeners.add(listener);
  return () => undoListeners.delete(listener);
}
function notifyUndoListeners() { undoListeners.forEach(l => l()); }

export function getUndoStackSize(): number { return undoStack.length; }

export function performUndo(): boolean {
  if (undoStack.length === 0) return false;
  const entry = undoStack.pop();
  if (!entry) return false;
  // Prevent capturing this restore as a new undo entry
  suppressUndoCapture = true;
  try {
    setToStorage(entry.key, entry.prevValue);
  } finally {
    suppressUndoCapture = false;
  }
  // Trigger a dataVersion bump so UI refreshes
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('schedule-data-updated'));
  }
  notifyUndoListeners();
  return true;
}

function setToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  // Capture previous value for undo (only for data keys, not currentUser)
  if (!suppressUndoCapture && SYNC_KEYS.has(key)) {
    try {
      const prev = localStorage.getItem(key);
      const prevValue = prev ? JSON.parse(prev) : null;
      undoStack.push({ key, prevValue, timestamp: Date.now() });
      if (undoStack.length > MAX_UNDO_HISTORY) undoStack.shift();
      notifyUndoListeners();
    } catch { /* ignore */ }
  }
  localStorage.setItem(key, JSON.stringify(value));
  // Sync to Firestore for shared data (debounced)
  if (SYNC_KEYS.has(key)) {
    if (firestoreSyncReady) {
      debouncedFirestoreSync(key, value);
    } else {
      // Queue the write until Firestore data has been loaded
      pendingWrites.set(key, value);
    }
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

// Timeline blocks: { [date]: { [memberId]: { [blockIndex]: taskId } } }
export function getTimelineBlocks(): Record<string, Record<string, Record<string, string>>> {
  return getFromStorage(STORAGE_KEYS.timeline, {});
}
export function setTimelineBlocks(data: Record<string, Record<string, Record<string, string>>>) {
  setToStorage(STORAGE_KEYS.timeline, data);
}
export function getTimelineForDate(date: string): Record<string, Record<string, string>> {
  return getTimelineBlocks()[date] || {};
}
export function setTimelineForDate(date: string, blocks: Record<string, Record<string, string>>) {
  const all = getTimelineBlocks();
  all[date] = blocks;
  setTimelineBlocks(all);
}

// Actual Timeline blocks: { [date]: { [memberId]: { [blockIndex]: taskName } } }
export function getActualTimelineBlocks(): Record<string, Record<string, Record<string, string>>> {
  return getFromStorage(STORAGE_KEYS.actualTimeline, {});
}
export function setActualTimelineBlocks(data: Record<string, Record<string, Record<string, string>>>) {
  setToStorage(STORAGE_KEYS.actualTimeline, data);
}
export function getActualTimelineForDate(date: string): Record<string, Record<string, string>> {
  return getActualTimelineBlocks()[date] || {};
}
export function setActualTimelineForDate(date: string, blocks: Record<string, Record<string, string>>) {
  const all = getActualTimelineBlocks();
  all[date] = blocks;
  setActualTimelineBlocks(all);
}

// ============ Actual Performance (per-date, per-member, per-task: count/points) ============
// Structure: { [date]: { [memberId]: { [taskName]: { count: number, points: number } } } }
export type ActualPerformanceEntry = { count: number; points: number };
export type ActualPerformanceData = Record<string, Record<string, Record<string, ActualPerformanceEntry>>>;

export function getActualPerformanceAll(): ActualPerformanceData {
  return getFromStorage(STORAGE_KEYS.actualPerformance, {});
}
export function setActualPerformanceAll(data: ActualPerformanceData) {
  setToStorage(STORAGE_KEYS.actualPerformance, data);
}
export function getActualPerformanceForDate(date: string): Record<string, Record<string, ActualPerformanceEntry>> {
  return getActualPerformanceAll()[date] || {};
}
export function setActualPerformanceForDate(date: string, data: Record<string, Record<string, ActualPerformanceEntry>>) {
  const all = getActualPerformanceAll();
  all[date] = data;
  setActualPerformanceAll(all);
}

// ============ Handover Requests ============
export function getHandovers(): HandoverRequest[] {
  return getFromStorage(STORAGE_KEYS.handovers, []);
}
export function setHandovers(items: HandoverRequest[]) {
  setToStorage(STORAGE_KEYS.handovers, items);
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

// Format a number with thousand-separator commas (e.g. 1000 -> "1,000").
// Accepts numbers and numeric strings; falls back to original on NaN.
export function fmtNum(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('ja-JP');
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
  selectedDate: string; // shared across pages (YYYY-MM-DD)
  setSelectedDate: (date: string) => void;
}

export const AppContext = createContext<AppContextType>({
  currentUserId: '',
  setCurrentUserId: () => {},
  members: DEFAULT_MEMBERS,
  refreshMembers: () => {},
  dataVersion: 0,
  firestoreReady: false,
  selectedDate: '',
  setSelectedDate: () => {},
});

export function useAppContext() {
  return useContext(AppContext);
}
