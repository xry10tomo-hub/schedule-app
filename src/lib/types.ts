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
  points: number;
  inspector: string;
  creator: string; // optional - empty means not yet completed
  createdAt: string;
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

export interface MemberSummary {
  memberId: string;
  memberName: string;
  totalPlannedMinutes: number;
  totalActualMinutes: number;
  totalTasks: number;
  completedTasks: number;
  efficiency: number; // actual / planned ratio
}
