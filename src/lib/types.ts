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
