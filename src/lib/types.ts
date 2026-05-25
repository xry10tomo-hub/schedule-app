export type MemberRole = 'employee' | 'parttime';

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  isAdmin: boolean;
  skills: string[];
  speedRatings: Record<string, number>; // taskName -> minutes per unit (小数点第1位)
  priorityRatings: Record<string, number>; // taskName -> priority (1=最優先, 数字が小さいほど優先)
  scheduledTimeRatings: Record<string, string[]>; // taskName -> array of time ranges (e.g. ["09:00-10:00", "14:00-15:00"])
  email?: string;
  // 週間デフォルトシフトパターン。キー='0'(日)〜'6'(土)、値={start, end}=出勤、未設定=休み
  defaultShifts?: Record<string, { start: string; end: string }>;
}

export interface DailyTask {
  id: string;
  date: string; // YYYY-MM-DD
  taskName: string;
  assigneeId: string;
  plannedCount: number; // 必要件数/点数/回数
  minutesPerUnit: number; // 1回あたりの時間(分)
  plannedMinutes: number; // 必要時間(分) = plannedCount * minutesPerUnit
  plannedPoints: number;
  actualCount: number;
  actualPoints: number;
  actualMinutes: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  status: 'pending' | 'in_progress' | 'completed';
  comment: string;
}

export interface MonthlySchedule {
  id: string;
  memberId: string; // kept for backward compat but not required for new entries
  date: string; // YYYY-MM-DD
  taskName: string; // task name or '固定業務'
  plannedHours: number;
}

// Resource per point for each task (editable in member management)
export interface TaskResource {
  taskName: string;
  minutesPerPoint: number; // minutes needed per 1 point
}

export interface ShippingRecord {
  id: string;
  date: string;
  carrier: string;
  dayType: string; // '当日' | '両日'
  itemCount: number;
  parcels: number; // 口数（通常1、複数店舗の場合2以上）
  points: number;
  inspector: string;
  creator: string; // optional - empty means not yet completed
  createdAt: string;
  carriedOver?: boolean; // true if this record was copied from previous day (prevents chain-carryover)
  carriedFromId?: string; // id of the source record this was copied from (for dedup)
}

export interface ShiftEntry {
  id: string;
  memberId: string;
  date: string;
  startTime: string;
  endTime: string;
  note: string;
}

export interface TaskDefinition {
  id: string;
  name: string;
  category: string;
  defaultPointsPerUnit: number;
  estimatedMinutesPerUnit: number;
}

export interface DailySummary {
  date: string;
  totalPlannedMinutes: number;
  totalActualMinutes: number;
  totalPlannedPoints: number;
  totalActualPoints: number;
  completionRate: number;
  gapMinutes: number;
}

export type HandoverStatus = 'pending' | 'approved' | 'rejected' | 'shared';

export interface HandoverRequest {
  id: string;
  applicantId: string; // member id who submitted
  targetDate: string; // YYYY-MM-DD - the day the task should be performed
  taskName: string; // selected from TaskDefinition list
  reason: string; // why the handover is needed
  detail: string; // free-form description
  status: HandoverStatus;
  reviewerId: string; // admin who reviewed (empty until reviewed)
  reviewComment: string;
  createdAt: number;
  reviewedAt: number; // 0 until reviewed
  completed?: boolean; // true when marked complete from HOME screen
  completedAt?: number;
  completedBy?: string; // member id who marked it complete
  customerName?: string; // optional customer name
  scheduledTime?: string; // optional time (HH:MM) when handover should be handled
  type?: 'handover' | 'important'; // 'handover' = 引き継ぎ, 'important' = 重要案件 (undefined treated as 'handover')
}

export type MemberTaskPriority = 'high' | 'medium' | 'low';
export type MemberTaskStatus = 'pending' | 'in_progress' | 'completed';

export interface MemberTask {
  id: string;
  assigneeId: string;            // 担当者 (member id)
  creatorId: string;             // 登録者 (member id)
  taskContent: string;           // 業務内容
  detail: string;                // 詳細・内容
  plannedCompletionDate: string; // 完了日（予定）YYYY-MM-DD
  priority: MemberTaskPriority;  // 優先度: high=高, medium=中, low=低
  status: MemberTaskStatus;      // ステータス: pending=未着手, in_progress=進行中, completed=完了
  createdAt: number;             // 登録日時 (timestamp)
  completedAt?: number;          // 実際の完了日時
  note?: string;                 // 備考
}

export interface MemberSummary {
  memberId: string;
  memberName: string;
  totalPlannedMinutes: number;
  totalActualMinutes: number;
  totalTasks: number;
  completedTasks: number;
  efficiency: number; // actual / planned ratio
}
