# スケジュール管理アプリ 完全仕様書

> ChatGPT 等の AI が本アプリを完全に把握し、的確な修正提案を生成できるよう、**データの取得元・計算式・コード参照（ファイル名+行番号）まで網羅した詳細仕様書**。

---

## 0. ファイルマップ（修正対象を素早く特定するための索引）

```
src/
├── app/
│   ├── home/page.tsx              # ホーム画面（実績入力の起点）
│   ├── calendar/page.tsx          # 月次カレンダー
│   ├── daily/page.tsx             # 日次業務入力（予定/実績/振り返り）
│   ├── shifts/page.tsx            # シフト一覧
│   ├── members/page.tsx           # メンバー管理
│   ├── shipping/page.tsx          # 郵送点数
│   ├── handover/page.tsx          # 共有BOX
│   ├── auto-assign/page.tsx       # AI自動割振
│   ├── admin/page.tsx             # 📊集計画面（最重要）
│   ├── admin/diagnostic/page.tsx  # Firestore診断ページ
│   └── login/page.tsx             # ログイン
├── components/
│   ├── AppProvider.tsx            # Firestore同期・グローバル状態
│   ├── DashboardLayout.tsx        # サイドバー付きレイアウト
│   ├── Sidebar.tsx                # サイドバー
│   ├── VersionChecker.tsx         # 新バージョン自動検出
│   └── NumberInput.tsx            # 数値入力共通コンポーネント
├── lib/
│   ├── store.ts                   # データ取得/保存・型・定数（最重要）
│   ├── firebase.ts                # Firebase初期化
│   ├── backup.ts                  # 日次バックアップ
│   └── types.ts                   # 全 TypeScript 型定義
```

---

## 1. アプリ概要

### 1.1 用途
社内（買取・販売業務）向け業務スケジュール管理ツール。シフト・業務予定・実績・引き継ぎを複数メンバーで共有・編集する。

### 1.2 技術スタック
- **フロント**: Next.js 16 App Router + React + TypeScript + Tailwind CSS v4
- **データストア**: localStorage（PCごと） + Firebase Firestore（中央）
- **同期方式**: localStorage 起点、Firestore に debounce push、`onSnapshot` で他PCの更新を受信
- **認証**: なし（メンバー選択型の擬似ログイン、`currentUserId` を localStorage で管理）
- **デプロイ**: Vercel (`https://schedule-app-nine-sage.vercel.app`)

---

## 2. データ層（最重要）

### 2.1 全ストレージキー（`STORAGE_KEYS` `src/lib/store.ts`）

| キー文字列（localStorage / Firestore共通） | 型 | 用途 |
|---|---|---|
| `schedule_members` | `Member[]` | メンバー一覧 |
| `schedule_daily_tasks` | `DailyTask[]` | 日次業務（日次業務入力画面の予定） |
| `schedule_monthly` | `MonthlySchedule[]` | 月次スケジュール（月次カレンダーで追加） |
| `schedule_shipping` | `ShippingRecord[]` | 郵送点数記録 |
| `schedule_shifts` | `ShiftEntry[]` | シフト |
| `schedule_task_defs` | `TaskDefinition[]` | 業務マスタ |
| `schedule_task_resources` | `TaskResource[]` | 業務×1点あたり分数（レガシー） |
| `schedule_timeline` | `Record<date, Record<memberId, Record<blockIdx, taskName>>>` | **予定タイムライン**（自動割振やホーム画面で生成） |
| **`schedule_actual_timeline`** | 同上 | ⭐**実績タイムライン（集計画面が使用）** |
| **`schedule_actual_performance`** | `Record<date, Record<memberId, Record<taskName, {count, points, shippingPoints?}>>>` | ⭐**ホーム実績入力（集計画面が使用）** |
| `schedule_handovers` | `HandoverRequest[]` | 引き継ぎ・重要案件 |
| `schedule_fixed_tasks` | `string[]` | 固定業務リスト |
| `schedule_fixed_task_defaults` | `Record<taskName, {plannedCount, minutesPerUnit}>` | 固定業務のデフォルト値 |
| `schedule_task_assignments` | `Record<taskName, TaskAssignmentConfig>` | 業務の対応可能メンバー・実施時間・対応人数 |
| `schedule_member_tasks` | `MemberTask[]` | メンバー別タスク |
| `schedule_no_break_members` | `Record<date, memberId[]>` | レガシー：休憩なしメンバー |
| `schedule_break_slots` | `Record<date, Record<memberId, 'early'|'late'|'skip'>>` | 休憩スロット |
| `schedule_current_user` | `string` | ログイン中のメンバーID |
| `schedule_selected_date` | `string` | 全画面共有の選択中日付 |

### 2.2 SYNC_KEYS（Firestore と同期するキー）
`src/lib/store.ts` の `SYNC_KEYS: Set<string>` に列挙。`schedule_current_user` と `schedule_selected_date` を除く全 STORAGE_KEYS が含まれる。

### 2.3 タイムラインのブロック構造
```typescript
TIMELINE_START = 8     // 8:00
TIMELINE_END = 22      // 22:00
BLOCKS_PER_HOUR = 4    // 15分単位
TOTAL_BLOCKS = 56      // (22-8)*4
```
- `blockIdx`：0〜55 の整数（文字列キーで保存：`"0"`〜`"55"`）
- `blockToTime(idx)` で `'H:MM'` に変換
- 例：`blockIdx=4` → `9:00`、`blockIdx=14` → `11:30`

### 2.4 主要な型（`src/lib/types.ts`）

```typescript
type MemberRole = 'employee' | 'parttime';

interface Member {
  id: string;                                   // 例: 'kumagai'
  name: string;                                 // 例: '熊谷'
  role: MemberRole;
  isAdmin: boolean;
  skills: string[];                             // できる業務名（後方互換用）
  speedRatings: Record<string, number>;         // {業務名: 分/単位}（小数1桁）
  priorityRatings: Record<string, number>;      // {業務名: 優先度(1=最優先)}
  scheduledTimeRatings: Record<string, string[]>; // {業務名: ['09:00-10:00', ...]}
  email?: string;
  defaultShifts?: Record<string, { start: string; end: string }>; // '0'(日)〜'6'(土)
}

interface DailyTask {
  id: string;
  date: string;            // 'YYYY-MM-DD'
  taskName: string;
  assigneeId: string;      // Member.id
  plannedCount: number;
  minutesPerUnit: number;
  plannedMinutes: number;  // = plannedCount * minutesPerUnit
  plannedPoints: number;
  actualCount: number;     // ⚠️集計画面では使わない
  actualPoints: number;    // ⚠️集計画面では使わない
  actualMinutes: number;   // ⚠️集計画面では使わない
  startTime: string;
  endTime: string;
  status: 'pending' | 'in_progress' | 'completed';
  comment: string;
}

interface MonthlySchedule {
  id: string;
  date: string;
  taskName: string;        // 業務名 or '固定業務'
  plannedHours: number;
  memberId: string;        // 未使用
}

interface ShiftEntry {
  id: string;
  memberId: string;
  date: string;
  startTime: string;       // 'HH:mm'
  endTime: string;
  note: string;
}

interface ShippingRecord {
  id: string;
  date: string;
  carrier: string;
  dayType: '当日' | '両日';
  itemCount: number;
  parcels: number;
  points: number;
  inspector: string;
  creator: string;         // 空 = 未完了（予定のまま）
  createdAt: string;
  carriedOver?: boolean;
  carriedFromId?: string;
}

interface TaskDefinition {
  id: string;
  name: string;            // '【LINE】画像査定' など
  category: string;
  defaultPointsPerUnit: number;
  estimatedMinutesPerUnit: number;
}

interface HandoverRequest {
  id: string;
  applicantId: string;
  targetDate: string;
  taskName: string;
  reason: string;
  detail: string;
  status: 'pending' | 'approved' | 'rejected' | 'shared';
  type?: 'handover' | 'important';
  completed?: boolean;
  completedAt?: number;
  completedBy?: string;
  customerName?: string;
  scheduledTime?: string;
  reviewerId: string;
  reviewComment: string;
  createdAt: number;
  reviewedAt: number;
}

interface MemberTask {
  id: string;
  assigneeId: string;      // 任意（空=未割当）
  creatorId: string;
  taskContent: string;
  detail: string;
  plannedCompletionDate: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: number;
  completedAt?: number;
  note?: string;
}

// `src/lib/store.ts` にて宣言
type TaskAssignmentConfig = {
  assignableMemberIds: string[];      // 対応可能メンバー（選択順=優先順位）
  scheduledStart: string;              // レガシー
  scheduledEnd: string;                // レガシー
  scheduledRanges?: { start: string; end: string }[]; // 実施時間（複数可）
  assigneeCount?: number;             // 対応人数（上位N名で分担）
};

type ActualPerformanceEntry = {
  count: number;
  points: number;
  shippingPoints?: number;            // 商材追い電話のみ
};
```

### 2.5 ストア関数（`src/lib/store.ts`）— データ取得・保存の入口

| 関数名 | 役割 | 戻り値の型 |
|------|------|---------|
| `getMembers()` | メンバー一覧取得 | `Member[]` |
| `setMembers(members)` | メンバー保存 | `void` |
| `getDailyTasks()` | 日次業務取得 | `DailyTask[]` |
| `setDailyTasks(tasks)` | 日次業務保存 | `void` |
| `getMonthlySchedules()` / `setMonthlySchedules()` | 月次スケジュール | — |
| `getShifts()` / `setShifts()` | シフト | — |
| `getTaskDefinitions()` / `setTaskDefinitions()` | 業務マスタ | — |
| `getTimelineBlocks()` | **予定タイムライン全体** | `Record<date, Record<memberId, Record<blockIdx, taskName>>>` |
| `getTimelineForDate(date)` | 特定日の予定タイムライン | `Record<memberId, Record<blockIdx, taskName>>` |
| `setTimelineForDate(date, blocks)` | 特定日の予定タイムライン保存 | `void` |
| `getActualTimelineBlocks()` | **実績タイムライン全体** ⭐ | 同上 |
| `getActualTimelineForDate(date)` | 特定日の実績タイムライン | `Record<memberId, Record<blockIdx, taskName>>` |
| `setActualTimelineForDate(date, blocks)` | 実績タイムライン保存（全上書き） | `void` |
| `getActualPerformanceAll()` | **ホーム実績入力全体** ⭐ | `Record<date, Record<memberId, Record<taskName, ActualPerformanceEntry>>>` |
| `getActualPerformanceForDate(date)` | 特定日のホーム実績 | `Record<memberId, Record<taskName, ActualPerformanceEntry>>` |
| `setActualPerformanceForDate(date, data)` | 特定日のホーム実績保存（全上書き） | `void` |
| `getShippingRecords()` / `setShippingRecords()` | 郵送点数 | — |
| `getHandovers()` / `setHandovers()` | 引き継ぎ | — |
| `getMemberTasks()` / `setMemberTasks()` | メンバー別タスク | — |
| `getFixedTasks()` / `setFixedTasks()` | 固定業務リスト | — |
| `getFixedTaskDefaults()` / `setFixedTaskDefaults()` | 固定業務デフォルト | — |
| `getTaskAssignments()` / `setTaskAssignments()` | 業務の対応可能メンバー設定 | `Record<taskName, TaskAssignmentConfig>` |
| `getBreakSlotsForDate(date)` / `setBreakSlotForDate(date, memberId, slot)` | 休憩スロット | — |
| `getDefaultBreakSlot(memberName)` | 名前から既定の休憩スロット推定 | `'early'|'late'|'skip'` |
| `runTaskMigration()` | 業務名リネーム/削除を全データに伝搬 | `boolean`（変更があったか） |

---

## 3. データ同期メカニズム

### 3.1 ライフサイクル
```
[アプリ起動]
1. AppProvider マウント
2. initFirestore() 実行
   - SYNC_KEYS の各キーについて Firestore からgetDoc
   - localStorage と比較してマージ（mergeArraysById or mergeNestedObjects）
   - localStorage に書き込み・必要なら Firestore へ書き戻し
3. setFirestoreSyncReady(true) — これ以降 Firestore Push が有効
4. ensureDailyBackup() — 当日バックアップ作成

[onSnapshot リスナー登録]
- SYNC_KEYS の各キーの doc を購読
- 自分の書込みエコー（hasPendingWrites）は無視
- 受信 → 配列なら mergeArraysById / nested は mergeNestedObjects
- ローカルに反映 + 必要なら Firestore に書き戻し（収束のため）

[ユーザーがデータ編集]
1. setTo Storage(key, data) 経由で localStorage.setItem
2. 200ms debounce後に writeWithRetry → setDoc で Firestore 上書き
3. setDoc 完了まで inflightWrites 管理（他の同期処理が読まないように）

[他PCで onSnapshot 発火]
1. data 受信
2. ローカル+リモートのマージ計算
3. 結果が違えばローカル更新 + setDataVersion
4. マージ結果がリモートと違えば Firestore に書き戻し
```

### 3.2 マージ戦略

| データ種別 | マージ関数 | 振る舞い |
|---------|---------|--------|
| 配列でid持ち（dailyTasks, members, shifts, monthlySchedules等） | `mergeArraysById` | id衝突時は **ローカル優先** |
| `PER_USER_NESTED_KEYS` = [`schedule_actual_performance`, `schedule_actual_timeline`] | `mergeNestedObjects` | 深いマージ、葉でローカル優先 |
| その他オブジェクト | `mergeNestedObjects` | 同上 |

### 3.3 既知の競合バグ
**現状の課題**：
- ユーザーAがホーム実績を入力 → A のローカル全データ（A・B両方のViewを含む）を Firestore Push
- ユーザーBが同時に入力 → 同様に Push
- 後勝ち書込みで前者のデータが Firestore 上で消える可能性
- `onSnapshot` 受信時のマージで自分のローカルは復元するが、過渡的に他PCで違う数値が見える

**対策（実装済み）**：
- `onSnapshot` 受信時にマージ結果と remote が違えば Firestore に書き戻し（収束ロジック）
- 集計画面：開いた瞬間 + 60秒ごとに `forceRefresh` で強制再取得
- 集計画面：手動「🔄 最新データに同期」ボタン

**根本対策（未実装）**：
- `actualPerformance` / `actualTimeline` の書込みを `updateDoc` のフィールドパスで「自分のIDの該当業務だけ」を更新する方式に変更すれば、競合不可

### 3.4 業務名マイグレーション
`src/lib/store.ts` の `runTaskMigration()`：
- `MIGRATION_KEY = 'schedule_task_rename_migration_v3'`（バージョン管理）
- `TASK_NAME_RENAMES`（旧名→新名のmap）と `TASK_NAMES_TO_REMOVE`（削除リスト）に基づいて全データを横断的に更新
- 更新対象：TaskDefinitions, DailyTasks, MonthlySchedules, Timeline, ActualTimeline, FixedTasks, FixedTaskDefaults, TaskAssignments, Handovers
- 注意：`member.speedRatings` / `priorityRatings` のキー名はマイグレーション対象に含まれていない

### 3.5 自動バックアップ
`src/lib/backup.ts`：
- アプリ起動時に当日バックアップが無ければ自動作成
- Firestore コレクション `appDataBackups/{YYYY-MM-DD}` に全 SYNC_KEYS を保存
- 30日経過したバックアップは自動削除
- 診断ページから手動バックアップ・復元可能

---

## 4. 画面別仕様（データソース・計算式付き）

---

### 4.1 🏠 ホーム画面 (`/home`, `src/app/home/page.tsx`)

#### 4.1.1 取得元データ
| 取得元 | 関数 | 用途 |
|------|------|------|
| `tasks` | `getDailyTasks().filter(t => t.date === selectedDate)` | 当日タスク |
| `timelineData` | `getTimelineForDate(selectedDate)` | 予定タイムライン |
| `actualTimelineData` | `getActualTimelineForDate(selectedDate)` | 実績タイムライン |
| `performanceData` | `getActualPerformanceForDate(selectedDate)` | ホーム実績入力 |
| `shiftsForDate` | `getShifts().filter(s => s.date === selectedDate)` | 当日シフト |
| `shippingRecords` | `getShippingRecords().filter(r => r.date === selectedDate)` | 当日郵送 |
| `handovers` | `getHandovers().filter(h => h.targetDate === selectedDate && shared/approved)` | 引き継ぎ |
| `members` | `useAppContext().members` | 全メンバー |
| `currentMember` | `members.find(m => m.id === currentUserId)` | ログイン中メンバー |

#### 4.1.2 セクション構成
1. **🎯 本日の目標カード**（オレンジ枠）
   - 対象業務：`TARGET_TASKS = ['【査定】計算書作成', '【LINE】画像査定']`
   - 値：`getSpeedPerPoint(taskName)` = `currentMember.speedRatings[taskName]`
   - 目標点：`Math.round((予定時間 / speed) * 10) / 10`
   - 予定時間：`myTimelineTasks[taskName]`（タイムラインから）or 各 dailyTask の `plannedMinutes` 合計

2. **📊 ステータスカード4枚**
   - 到着件数：`shippingRecords.length`
   - 到着点数：`shippingRecords` の `points` 合計
   - チーム全体タスク：`tasks.length` / 完了済み件数
   - 予実差分：`actualMinutes - plannedMinutes`

3. **業務構成比グラフ** + **郵送点数グラフ**

4. **本日の引き継ぎ・重要案件・業務一覧**

5. **自分の予定タイムライン**（参照のみ）

6. **実績タイムライン**（クリック塗りで入力）⭐
   - クリック時：`actualTimelineData[currentUserId][blockIdx] = selectedPaintTask`
   - 保存：`setActualTimelineForDate(selectedDate, newData)` → `schedule_actual_timeline` 全上書き

7. **業務別 実績入力欄**（件数/点数/郵送点数）⭐
   - 対象業務：`TASK_PERF_CONFIG` で定義
     ```typescript
     {
       '【LINE】画像査定': { points: true },
       '【査定】計算書作成': { count: true, points: true },
       '【査定】計算書提出': { count: true },
       '【査定】計算書（下書き）': { count: true },
       '【補助】郵送物開封': { count: true },
       '【補助】返送': { count: true },
       '【営業】商材追い電話': { count: true, points: true, shippingPoints: true },
     }
     ```
   - 入力時：`saveMyPerformance(taskName, field, value)` 関数（行130-137）
     ```typescript
     newData[currentUserId][taskName][field] = value;
     setActualPerformanceForDate(selectedDate, newData);  // 全上書き
     ```
   - 保存先：`schedule_actual_performance` の `[date][currentUserId][taskName][field]`
   - **これが集計画面が読む唯一のソース**

8. **時刻超過アラート**
   - 対象+時刻：
     ```typescript
     ALERT_SCHEDULE = {
       '【補助】返送': '15:00',
       '【査定】再提出': '09:45',
     };
     ```
   - 発火条件：`currentMinutes >= scheduledMinutes + 1` かつ `currentMinutes <= scheduledMinutes + 31`
   - 消去条件（いずれか）：
     - 30分経過
     - 当該業務の `actualTimeline` にブロックあり
     - `performanceData` 全員分の `count > 0`
     - `tasks` 内の当該業務が `status === 'completed'`
     - × ボタンで手動消去
   - 通知方式：画面右上の赤いトースト + デスクトップ Notification API

---

### 4.2 📅 月次カレンダー (`/calendar`, `src/app/calendar/page.tsx`)

#### 4.2.1 取得元データ
| 関数 | 用途 |
|------|------|
| `getMonthlySchedules()` | 月次スケジュール一覧 |
| `getTaskDefinitions()` | 業務マスタ |
| `getFixedTasks()` / `getFixedTaskDefaults()` | 固定業務管理パネルで使用 |

#### 4.2.2 機能
- 月単位の表、各日セルに業務名チップで予定を表示
- セル右上の「+」ボタンでフォーム開閉
- フォーム内：
  - プルダウン選択（「★固定業務」含む業務マスタ）
  - 直接入力
  - **期間指定**：終了日を指定すると開始日〜終了日に一括追加
- 業務マスタ管理：折り畳みパネルで追加・削除
- ★固定業務マスタ管理：折り畳みパネルで固定業務リストと件数/時間編集

#### 4.2.3 OL割当チップ
コード内に静的データ：
```typescript
OL_ASSIGNMENTS = {
  '2026-05-18': ['熊谷', '鈴木'],
  '2026-05-25': ['潮田', '国兼'],
  '2026-06-01': ['熊谷', '和田'],
  '2026-06-08': ['国兼', '鈴木'],
  '2026-06-15': ['潮田', '和田'],
  '2026-06-22': ['熊谷', '国兼'],
  '2026-06-29': ['鈴木', '和田'],
};
```
- 平日（月-金）の各セル右上に「🔄 OL: 〇〇・〇〇」チップ
- 関数：`getOLForDay(year, month, day, dayOfWeek)`（その日の月曜の日付キーで検索）

---

### 4.3 📝 日次業務入力 (`/daily`, `src/app/daily/page.tsx`)

#### 4.3.1 取得元データ
| 関数 | 用途 |
|------|------|
| `getDailyTasks().filter(t => t.date === selectedDate)` | 当日タスク |
| `getTaskDefinitions()` | 業務マスタ |
| `getMonthlySchedules()` | 月次から当日反映用 |
| `getHandovers()` | 承認済み引き継ぎを当日反映 |
| `getShifts()` | シフト |
| `getTimelineForDate(selectedDate)` | 予定タイムライン |
| `getActualTimelineForDate(selectedDate)` | 実績タイムライン |
| `getActualPerformanceForDate(selectedDate)` | ホーム実績 |
| `getTaskAssignments()` | 対応可能メンバー・実施時間設定 |
| `getMembers()` / `setMembers()` | 個人スピード保存用 |

#### 4.3.2 タブ構成
- `viewTab: 'plan' | 'actual' | 'review'`
- `plan` がデフォルト

#### 4.3.3 予定入力タブ（plan）
業務マトリックスの列：

| 列 | 値の取得元 | 保存先 |
|---|---|---|
| 業務名 | `dailyTask.taskName` | — |
| 必要件数 | `dailyTask.plannedCount` | `setDailyTasks` |
| 1回あたり時間(分) | `dailyTask.minutesPerUnit` | `setDailyTasks` |
| 必要時間(分) | 自動算出 = `plannedCount × minutesPerUnit` | `dailyTask.plannedMinutes` |
| 対応可能メンバー | `taskAssignments[taskName].assignableMemberIds`（**選択順=優先順位**） | `setTaskAssignments` |
| ピッカー内：分/点 or 分/件 | `member.speedRatings[taskName]` | `setMembers(updated)` |
| 実施時間 | `taskAssignments[taskName].scheduledRanges[]` | `setTaskAssignments` |
| 対応人数 | `taskAssignments[taskName].assigneeCount` | `setTaskAssignments` |

業務並び順（`sortTasks` 関数）：
1. 引き継ぎ業務（`comment === '引き継ぎ'`）が最上位
2. `PRIORITY_TASK_ORDER` 配列の順
3. id 昇順（決定的タイブレーク）

#### 4.3.4 実績集計タブ（actual）
- 個人別タイムライン（メンバー × 56ブロック）を表示
- 業務選択して塗ると `actualTimeline[currentUserId][blockIdx] = taskName`
- 保存：`setActualTimelineForDate`

#### 4.3.5 振り返りタブ（review）

**部門別ランキング**（2部門）：
- `RANKING_TASKS = ['【LINE】画像査定', '【査定】計算書作成']`
- 評価対象：
  - `taskAssignments[業務].assignableMemberIds` に含まれる
  - `member.speedRatings[業務] > 0`
  - 当日の `actualMinutes > 0`（タイムラインから集計）
  - 当日の `actualPoints > 0`（performance から集計）
- 並び順：`(actualSpeed - targetSpeed)` 昇順 → 目標を最も上回った人が1位
- 評価ラベル：
  - `🚀 目標より X.X分/点 速い`（delta <= -0.1）
  - `✅ 目標どおり`（-0.1 < delta < 0.1）
  - `📈 目標より X.X分/点 遅い`（0.1 <= delta < target*0.3）
  - `⚠️ 目標より X.X分/点 遅い`（delta >= target*0.3）

**📊 予定 vs タイムライン GAP**（折り畳み）：
- 行：業務名
- 列：予定（日次）/ タイムライン合計 / GAP

---

### 4.4 📆 シフト一覧 (`/shifts`, `src/app/shifts/page.tsx`)

#### 4.4.1 取得元データ
- `getShifts()`、`getMembers()`、`getDaysInMonth()`

#### 4.4.2 機能
- メンバー × 日 のマトリックス
- セルクリックでプリセット時間帯選択 → `ShiftEntry` を追加
- **🗓 週間デフォルトパターン**：曜日ごとに固定シフトを設定
  - 保存：`member.defaultShifts[dow]` （dow: '0'(日)〜'6'(土)）
  - 月切替時、各メンバーの未入力日に自動シフト追加
- CSV出力

---

### 4.5 👥 メンバー管理 (`/members`, `src/app/members/page.tsx`)

#### 4.5.1 取得元データ
- `getMembers()`、`getTaskDefinitions()`、`getFixedTasks()`、`getFixedTaskDefaults()`

#### 4.5.2 スキル・優先順位マトリックス（紫枠、最上部）
- 行：メンバー、列：業務、セル：`speedRating` または `priorityRating`
- インライン編集：クリック → 数値入力 → `setMembers(updated)`
- 右クリック：対応不可化（`skills` から削除 + speed/priority も削除）
- カテゴリフィルタ + 「全カテゴリ」

#### 4.5.3 メンバーカード
- スキル一覧 + 各業務の `speedRating` / `priorityRating` / `scheduledTimeRatings`

#### 4.5.4 ★固定業務マスタ管理
- `getFixedTasks()` / `setFixedTasks()` で固定業務リスト編集
- `getFixedTaskDefaults()` / `setFixedTaskDefaults()` で件数・時間編集

---

### 4.6 📦 郵送点数 (`/shipping`, `src/app/shipping/page.tsx`)

#### 4.6.1 取得元データ
- `getShippingRecords()`、`getDailyTasks()`、`getActualPerformanceForDate(selectedDate)`、`getShifts()`

#### 4.6.2 自動持ち越しロジック
当日表示時のみ作動：
1. `selectedDate === today` をチェック
2. 前日（`prevDateStr`）の `creator` 空のレコードを抽出
3. `carriedFromId` で重複チェック（既に今日に持ち越し済みなら skip）
4. 残りを今日のレコードとして追加（id は決定的：`carry-${selectedDate}-${元id}`）
5. 前日の対象レコードは **削除**

#### 4.6.3 担当者→ホーム実績への同期
`syncCreatorToPerformance()`：商材追い電話の`creator`名を集計し、該当メンバーの `actualPerformance[date][memberId][業務].count/points` に書き込む

---

### 4.7 📨 共有BOX (`/handover`, `src/app/handover/page.tsx`)

#### 4.7.1 タブ
- 新規共有（引き継ぎ / 重要案件）
- 引き継ぎ一覧
- 重要案件一覧
- **メンバー別タスク**

#### 4.7.2 メンバー別タスク仕様
- データ：`MemberTask[]`、`getMemberTasks()` / `setMemberTasks()`
- 担当者：**任意項目**（空=「未割当」）
- フィルタ：
  - 担当者
  - ステータス（「全ステータス」選択時はデフォルトで完了非表示）
  - **「完了も表示」チェックボックス**（既定OFF）
- ソート：優先度（high→medium→low）→ `plannedCompletionDate` 昇順

---

### 4.8 🤖 AI自動割振 (`/auto-assign`, `src/app/auto-assign/page.tsx`)

#### 4.8.1 取得元データ
| 関数 | 用途 |
|------|------|
| `getDailyTasks().filter(t => t.date === selectedDate)` | 当日タスク |
| `getShifts().filter(s => s.date === selectedDate)` | 当日シフト |
| `getTaskAssignments()` | 対応可能メンバー・実施時間設定 |
| `useAppContext().members` | 全メンバー |
| `getBreakSlotsForDate(selectedDate)` | 休憩スロット設定 |

#### 4.8.2 アルゴリズム（`runAutoAssignAlgorithm`）

**Step 1: 休憩割当**
- 休憩窓：12:00〜14:30
- 早スロット（blocks 16-19）= 12:00-13:00
- 遅スロット（blocks 21-24）= 13:15-14:15
- 各メンバーのスロットは `breakSlotsMap[memberId]`、無ければ `getDefaultBreakSlot(memberName)` で名前から推定：
  - `['潮田', '国兼', '三原', '石井']` → 'early'
  - `['和田', '熊谷', '鈴木']` → 'late'
  - 他 → 'early'（fallback）
- `'skip'` のメンバーは休憩割当しない

**Step 2: 実施時間が設定されたタスクの配置**
- `taskAssignments[業務].scheduledRanges` がある業務を対象
- **必要時間（必要件数 × 1回あたり時間）でキャップ**
- 上位N名（assigneeCount）の対応可能メンバーに速度重み付けで配分
- スピード重み = `1 / max(speedRating || defaultSpeed, 0.1)`
- 各メンバーの担当ブロック数 = `round(weight / totalWeight * blocksNeeded)`

**Step 3: 残タスクのフォールバック配置**
- Pass 1：上位N名で配分
- Pass 2：GAPがあれば全対応可能メンバーに拡大
- Pass 3：`assigneeCount` 未設定 + GAPあれば、最も空き多いメンバーに配分

**周期配置タスク**：
```typescript
PERIODIC_TASKS = ['【LINE】LINE整理', '【LINE】要対応'];
```
- これらは3ブロック（45分）以上の間隔を空けて配置

#### 4.8.3 「AI自動割振を実行」ボタン
- `handleAutoAssign()` 実行
- 結果を `previewTimeline` に保存（プレビュー表示）
- **同時にタイムラインに即反映**：`setTimelineForDate(date, result)`
- **日次業務入力の `assigneeId` も自動更新**（最も多く担当したメンバーに割当）

---

### 4.9 📊 集計画面 (`/admin`, `src/app/admin/page.tsx`) ⭐⭐⭐ **最重要**

#### 4.9.1 取得元データの完全マップ

```typescript
// メイン取得（src/app/admin/page.tsx 行92-103）
useEffect(() => {
  setAllTasks(getDailyTasks().filter(t => t.date.startsWith(monthStr)));
}, [monthStr, dataVersion]);

const monthData = useMemo(() => {
  return {
    allActualTl: getActualTimelineBlocks(),  // 実績タイムライン全体
    allPerf: getActualPerformanceAll(),       // ホーム実績入力全体
    allPlanTl: getTimelineBlocks(),           // 予定タイムライン全体
    allShifts: getShifts(),                   // 全シフト
  };
}, [dataVersion]);

const { members, dataVersion, forceRefresh } = useAppContext();
```

#### 4.9.2 同期メカニズム
```typescript
// 行56-64: 開いた瞬間 + 60秒ごとに forceRefresh
useEffect(() => {
  forceRefresh();
  setLastSyncAt(Date.now());
  const id = setInterval(() => {
    forceRefresh();
    setLastSyncAt(Date.now());
  }, 60_000);
  return () => clearInterval(id);
}, [forceRefresh]);

// 手動同期ボタン handleManualSync()
```

#### 4.9.3 マトリックス データ計算（行138-187）

```typescript
const matrix = useMemo(() => {
  // 1. 表示対象業務名の収集
  //    - allTasks（日次タスク）の taskName
  //    - allActualTl（実績タイムライン）の値
  //    - allPerf（ホーム実績）でcount>0 or points>0のもの
  //    PRIORITY_TASKS + 固定業務 + アルファベットの順でソート
  //    showAllTasks が false なら PRIORITY_TASKS のみ

  // 2. data[業務名][日] = { minutes, count, points, shippingPoints }
  for (const tn of taskNames) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      let minutes = 0, count = 0, points = 0, shippingPoints = 0;

      // ① 実績タイムラインから minutes 集計
      const dateActualTl = monthData.allActualTl[dateStr] || {};
      Object.entries(dateActualTl).forEach(([memberId, blocks]) => {
        if (selectedMemberId && memberId !== selectedMemberId) return;
        Object.values(blocks).forEach(blockTaskName => {
          if (blockTaskName === tn) minutes += 15;
        });
      });

      // ② ホーム実績入力から count/points/shippingPoints 集計
      const datePerf = monthData.allPerf[dateStr] || {};
      Object.entries(datePerf).forEach(([memberId, taskPerfs]) => {
        if (selectedMemberId && memberId !== selectedMemberId) return;
        const entry = taskPerfs[tn];
        if (entry) {
          count += entry.count || 0;
          points += entry.points || 0;
          shippingPoints += (entry as any).shippingPoints || 0;
        }
      });

      data[tn][d] = { minutes, count, points, shippingPoints };
    }
  }
  return { taskNames, data };
}, [allTasks, monthData, daysInMonth, monthStr, selectedMemberId, showAllTasks, members]);
```

**重要：使わないデータ**：
- ❌ `dailyTask.actualMinutes`
- ❌ `dailyTask.actualCount`
- ❌ `dailyTask.actualPoints`
- ❌ 件数×個人スピードによる推定値

→ **ホーム画面に入力がなければ集計に積み上がらない**

#### 4.9.4 表示指標

```typescript
type Metric = 'minutes' | 'count' | 'points' | 'speed' | 'shippingPoints' | 'shippingRate';

METRIC_LABELS = {
  minutes: '実績時間（分）',
  count: '件数',
  points: '点数',
  speed: '平均スピード',
  shippingPoints: '郵送点数',
  shippingRate: '郵送率',
};

METRIC_ORDER = ['minutes', 'count', 'points', 'speed'];  // 既定4指標
```

#### 4.9.5 業務別の表示指標数
```typescript
SHIPPING_METRIC_TASKS = ['【営業】商材追い電話'];  // 6指標
POINTS_BASED_SPEED_TASKS = ['【LINE】画像査定', '【査定】計算書作成', '【営業】商材追い電話'];

function metricsForTask(taskName) {
  if (SHIPPING_METRIC_TASKS.includes(taskName)) {
    return ['minutes', 'count', 'points', 'speed', 'shippingPoints', 'shippingRate'];
  }
  return METRIC_ORDER;
}
```

#### 4.9.6 セル値の計算式（`formatCellByMetric`）

```typescript
function formatCellByMetric(taskName, day, metric) {
  const cell = matrix.data[taskName][day];  // { minutes, count, points, shippingPoints }

  if (metric === 'minutes')  return cell.minutes > 0 ? fmtNum(cell.minutes) : '';
  if (metric === 'count')    return cell.count > 0 ? fmtNum(cell.count) : '';
  if (metric === 'points')   return cell.points > 0 ? fmtNum(cell.points) : '';

  if (metric === 'shippingPoints') return cell.shippingPoints > 0 ? fmtNum(cell.shippingPoints) : '';

  if (metric === 'shippingRate') {
    // 郵送率 = 郵送点数 / 点数 × 100
    return (cell.points > 0 && cell.shippingPoints > 0)
      ? `${Math.round((cell.shippingPoints / cell.points) * 1000) / 10}%`
      : '';
  }

  if (metric === 'speed') {
    // 平均スピード：商材追い電話・LINE画像査定・計算書作成は「分/点」、それ以外は「分/件」
    const usePoint = POINTS_BASED_SPEED_TASKS.includes(taskName);
    const denom = usePoint ? cell.points : cell.count;
    return (denom > 0 && cell.minutes > 0)
      ? `${Math.round((cell.minutes / denom) * 10) / 10}`
      : '';
  }
}
```

#### 4.9.7 行合計 / 列合計 / 総合計

```typescript
function rowTotal(taskName) {
  // taskName の月内合計
  let mins = 0, cnt = 0, pts = 0, sp = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const c = matrix.data[taskName][d];
    mins += c.minutes; cnt += c.count; pts += c.points; sp += c.shippingPoints;
  }
  const usePoint = POINTS_BASED_SPEED_TASKS.includes(taskName);
  const denom = usePoint ? pts : cnt;
  const speed = (denom > 0 && mins > 0) ? `${Math.round((mins/denom)*10)/10}` : '';
  const shippingRate = (pts > 0 && sp > 0) ? `${Math.round((sp/pts)*1000)/10}%` : '';
  return { minutes: mins, count: cnt, points: pts, shippingPoints: sp, speed, shippingRate };
}

function colTotal(day) {
  // day の業務横断合計
  // 全業務の minutes/count/points を合計（shippingPointsはNULL扱い）
}

const grandTotal = useMemo(() => {
  // 全業務×全日の合計
  matrix.taskNames.forEach(tn => {
    const r = rowTotal(tn);
    mins += r.minutes; cnt += r.count; pts += r.points;
  });
}, [matrix]);
```

#### 4.9.8 既定優先業務
```typescript
PRIORITY_TASKS = [
  '【LINE】画像査定',
  '【査定】計算書作成',
  '【査定】計算書提出',
  '【営業】商材追い電話',
  '【営業】受け電話',
  '【査定】計算書（下書き）',
  '【査定】両日提出',
  '【補助】郵送物開封',
];
```
- 「全業務表示」OFF時は PRIORITY_TASKS のみ表示

#### 4.9.9 業務並び順
```typescript
priorityIdx(name) {
  // 1. PRIORITY_TASKS の順
  // 2. getFixedTasks() の順（固定業務）
  // 3. それ以外 → アルファベット順
}
```

#### 4.9.10 個人別パフォーマンスサマリ（参考表示、行267-285）
```typescript
memberPerformance = members.map(m => {
  let totalMinutes = 0, totalCount = 0, totalPoints = 0;

  // 月内全日のタイムラインから minutes 集計
  Object.values(monthData.allActualTl).forEach(dateData => {
    const memberBlocks = dateData[m.id] || {};
    totalMinutes += Object.keys(memberBlocks).length * 15;
  });

  // 月内全日のホーム実績から count/points 集計
  Object.values(monthData.allPerf).forEach(dateData => {
    const taskPerfs = dateData[m.id] || {};
    Object.values(taskPerfs).forEach(entry => {
      totalCount += entry.count || 0;
      totalPoints += entry.points || 0;
    });
  });

  return { id, name, role, totalMinutes, totalCount, totalPoints };
});
```

#### 4.9.11 業務構成比（CSV出力時に追加）
- 構成比(%) = `(planned timeline minutes for this task) / (total shift minutes for this day) × 100`
- 「予定タイムラインの分」÷「シフト合計分」

#### 4.9.12 既知の課題（修正候補）
1. **複数PCで集計値が一致しない**
   - 原因：Firestore書込み競合により他人のデータが上書きされて消える
   - 現状対策：onSnapshot で受信時にローカルとマージして書き戻し + 集計画面で60秒ごとforceRefresh
   - 根本対策：`updateDoc` のフィールドパス指定で「自分のIDの該当業務エントリだけ」を更新する方式に変更

2. **個人別マトリックスがない**：現状は「全員集計」と「個人別フィルタ」のみ。マトリックスでメンバーごとに分けて見れない

3. **マイグレーションが speedRatings に伝搬しない**：業務名変更時に `member.speedRatings[旧名]` が残る

---

### 4.10 🔍 診断ページ (`/admin/diagnostic`, `src/app/admin/diagnostic/page.tsx`)

#### 機能
- 各 SYNC_KEY の Firestore 存在状況・最終更新・サイズ
- 月別の日別データ存在状況（実績タイムライン人数/ブロック数、ホーム実績エントリ数、DailyTask件数）
- 🗄️ バックアップ一覧
- 📸 手動バックアップ作成
- 🔧 バックアップから復元（マージ or 完全上書き）
- 📥 全データJSONダウンロード
- 📄 `actualTimeline` / `actualPerformance` の生JSON表示

---

## 5. メンバー一覧（DEFAULT_MEMBERS）

| id | name | role | isAdmin |
|----|------|------|--------|
| `wada` | 和田 | employee | false |
| `ushioda` | 潮田 | employee | **true** |
| `kunigane` | 国兼 | employee | false |
| `kumagai` | 熊谷 | employee | false |
| `suzuki` | 鈴木 | employee | false |
| `mihara` | 三原 | parttime | false |
| `nakatani` | 中谷 | parttime | false |
| `sato` | 佐藤 | parttime | false |
| `ishii` | 石井 | parttime | false |
| `kagami` | 加々美 | parttime | false |

---

## 6. 業務マスタ（DEFAULT_TASKS）

### 6.1 カテゴリ
```
['LINE', '営業', '査定', '販売', '社内', '売却',
 '補助', '配信準備', 'タグ', '集計データ更新', 'OL', 'その他']
```

### 6.2 業務名フォーマット
`【カテゴリ】業務名`（例：`【LINE】画像査定`）

### 6.3 主要業務（抜粋）

**LINE**:
`【LINE】画像査定` / `【LINE】LINE整理` / `【LINE】要対応` / `【LINE】商材追いLINE`

**査定**:
`【査定】計算書作成` / `【査定】計算書提出` / `【査定】計算書（下書き）` / `【査定】再提出` / `【査定】両日提出`

**営業**:
`【営業】商材追い電話` / `【営業】受け電話`

**販売（35業務）**:
`【販売】売却準備` / `【販売】明細確認・交渉` / `【販売】mb発送` / `【販売】NJ発送` 他多数

**売却**:
`【売却】承諾確認・催促` / `【売却】潰し分け` / `【売却】潰し` / `【売却】売却準備`

**補助**:
`【補助】郵送物開封` / `【補助】返送` / `【補助】相場更新` / `【補助】ファイル移動`

**社内**:
`【社内】ミーティング` / `【社内】問題解決` / `【社内】業務改善` / `【社内】マニュアル作成`

**OL**:
`【OL】進捗確認` / `【OL】スケジュール作成`

**その他**:
`【その他】備品管理集計` / `【その他】メルベーユ確認` / `【その他】教育` / `【他】休憩` / `【他】掃除` / `【その他】有休`

### 6.4 固定業務（DEFAULT_FIXED_TASK_NAMES）
月次カレンダーで「★固定業務」を選んだ日に展開される業務リスト：
```
【LINE】画像査定 / 【LINE】LINE整理 / 【LINE】要対応 / 【LINE】商材追いLINE /
【査定】計算書作成 / 【査定】計算書提出 / 【査定】計算書（下書き） /
【社内】ミーティング /
【売却】承諾確認・催促 / 【売却】潰し分け / 【売却】潰し / 【売却】売却準備 /
【補助】郵送物開封 / 【補助】返送 / 【補助】相場更新 /
【OL】進捗確認 / 【OL】スケジュール作成 /
【販売】明細確認・交渉 / 【販売】AVE請求 /
【営業】商材追い電話 / 【営業】受け電話 /
【他】休憩
```

---

## 7. 修正パターン集（AI向け）

### 7.1 集計画面で「業務×メンバー」のマトリックスを追加したい
- `src/app/admin/page.tsx` の `matrix` useMemo を拡張
- `data[業務名][日][memberId] = { minutes, count, points }` の3次元構造に変更
- 既存の集計（全員合算）と並行表示でも、選択モード切替でもOK

### 7.2 新しい指標を追加したい（例：商材追い電話のキャンセル数）
1. `types.ts` の `ActualPerformanceEntry` に新フィールド `cancelCount?: number` を追加
2. `home/page.tsx` の `TASK_PERF_CONFIG` に `cancelCount: true` を追加
3. `home/page.tsx` のレンダリングと `saveMyPerformance` の field 引数に追加
4. `admin/page.tsx` の `Metric` 型に追加、`METRIC_LABELS`/`METRIC_BG`/`METRIC_TEXT` に追加、`formatCellByMetric` に分岐追加

### 7.3 業務名のリネーム
1. `src/lib/store.ts` の `TASK_NAME_RENAMES` に `'旧名': '新名'` を追加
2. `MIGRATION_KEY` を `'schedule_task_rename_migration_v3'` から `'..._v4'` に bump
3. （新業務を追加する場合）`DEFAULT_TASKS` にエントリ追加

### 7.4 メンバーを追加
1. `src/lib/store.ts` の `DEFAULT_MEMBERS` に追記
2. `id` はユニーク、`name` は表示名、`role` は 'employee' or 'parttime'

### 7.5 アラート対象を追加
- `src/app/home/page.tsx` の `ALERT_SCHEDULE` に `'業務名': 'HH:MM'` を追加

### 7.6 OL割当を変更
- `src/app/calendar/page.tsx` 冒頭の `OL_ASSIGNMENTS` 定数（月曜日付キーで指定）

### 7.7 Firestore競合バグの根本対策
- `home/page.tsx` の `saveMyPerformance` で `setActualPerformanceForDate` の代わりに、新たに作る `updateMyActualPerformanceEntry(date, memberId, taskName, entry)` を呼ぶ
- 内部実装：`updateDoc(doc(db, 'appData', 'schedule_actual_performance'), { [\`value.${date}.${memberId}.${taskName}\`]: entry })` でフィールドパス更新
- タイムライン側も同様

---

## 8. 修正依頼テンプレート（ChatGPT 向け）

```
[修正対象画面]: 例 → 集計画面 (/admin)
[ファイル]: 例 → src/app/admin/page.tsx
[現状の動作]: 例 → matrix は業務×日×{minutes, count, points} で集計しているが、メンバーごとに分けたい
[期待する動作]: 例 → ピボットで「業務×メンバー」のマトリックスに切替可能にしたい
[制約]:
  - 既存の actualPerformance / actualTimeline のデータ構造はそのまま使う
  - dailyTask.actual* は使わない
[影響範囲]: 集計画面のみ、他画面には影響しない
```

このテンプレを SPEC.md と一緒に貼り付けて ChatGPT に投げれば、正確な型・関数・行番号を踏まえた修正案が得られます。

---

## 9. 注意事項（AI 重要メモ）

1. **集計画面は `dailyTask.actual*` を絶対に使わない**
   - `actualPerformance` + `actualTimeline` の2つだけが集計ソース

2. **Firestore 書込みは現状全体上書き**
   - 競合の可能性。`updateDoc` フィールドパス指定への変更が根本対策

3. **`schedule_selected_date` はグローバル状態**
   - `AppContext.selectedDate` で全画面共有

4. **業務名のカテゴリ表記の揺れ**
   - 「その他」と「他」が混在（例：`【その他】備品管理集計` vs `【他】休憩`）

5. **ピッカーの「対応可能メンバー」は選択順=優先順位**
   - 自動割振はこの順を尊重して上位N名で分担

6. **同じデータが複数画面から編集可能**
   - 例：`member.speedRatings` はメンバー画面マトリックス + 日次入力ピッカー、両方から編集

7. **Next.js は「training-data既知の従来版」と異なる**
   - 修正コードは `node_modules/next/dist/docs/` の最新仕様を参照すること（CLAUDE.md/AGENTS.md より）

---

## 10. 全画面データフロー早見表（READ / COMPUTE / WRITE）

各画面の「どこから読み」「何を計算し」「どこへ書く」を機械的に整理。集計画面以外も同じ粒度で記載。

---

### 10.1 🏠 ホーム画面 `/home`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 日次タスク（当日） | `getDailyTasks().filter(t => t.date === selectedDate)` | `schedule_daily_tasks` | `DailyTask[]` |
| 郵送レコード（当日）| `getShippingRecords().filter(r => r.date === selectedDate)` | `schedule_shipping` | `ShippingRecord[]` |
| 予定タイムライン | `getTimelineForDate(selectedDate)` | `schedule_timeline` | `Record<memberId, Record<blockIdx, taskName>>` |
| 実績タイムライン | `getActualTimelineForDate(selectedDate)` | `schedule_actual_timeline` | 同上 |
| ホーム実績入力 | `getActualPerformanceForDate(selectedDate)` | `schedule_actual_performance` | `Record<memberId, Record<taskName, {count, points, shippingPoints?}>>` |
| 業務マスタ | `getTaskDefinitions()` | `schedule_task_defs` | `TaskDefinition[]` |
| 引き継ぎ | `getHandovers().filter(...shared/approved)` | `schedule_handovers` | `HandoverRequest[]` |
| シフト（当日）| `getShifts().filter(s => s.date === selectedDate)` | `schedule_shifts` | `ShiftEntry[]` |
| メンバー | `useAppContext().members` | `schedule_members` | `Member[]` |
| 現在ユーザー | `useAppContext().currentUserId` | `schedule_current_user` | `string` |

#### COMPUTE
- `blockToTime(idx)`: 8:00開始、15分単位（例：idx=4 → "9:00"）
- `myBlocks = timelineData[currentUserId]` : 自分の予定ブロック
- `myTimelineTasks`: 業務名 → 合計分（15分×ブロック数）
- `myProgress`: 実績件数 / 予定件数 × 100
- `getTargetPoints(taskName, minutes)` = `minutes / member.speedRatings[taskName]`（小数1桁）
- 郵送残リソース：`(残点数) × 2分` で必要時間算出
- 業務構成比：当日の予定タイムラインを業務別に集計し、リソース全体に対する割合
- 18時超過アラート判定：`currentMinutes >= ALERT_SCHEDULE時刻 + 1` かつ 30分以内

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| 実績タイムラインのブロック塗り | `updateMyActualTimelineBlock(date, userId, blockIdx, taskName)` | `schedule_actual_timeline` | `[date][userId][blockIdx] = taskName` |
| 実績件数/点数/郵送点数入力 | `updateMyActualPerformanceEntry(date, userId, taskName, entry)` | `schedule_actual_performance` | `[date][userId][taskName] = {count, points, shippingPoints?}` |
| 引き継ぎ完了チェック | `setHandovers(updated)` | `schedule_handovers` | `completed: true, completedAt, completedBy` |
| 業務マスタ追加（モーダル）| `setTaskDefinitions([...all, new])` | `schedule_task_defs` | 新 `TaskDefinition` |

#### SECTIONS
- 18時超過アラート（右上トースト）
- 到着件数/点数サマリ（4枚）
- 業務構成比グラフ
- 郵送点数進捗グラフ（当日/両日/合計）
- 本日の引き継ぎ・重要案件
- 🎯 本日の目標（計算書作成・画像査定）
- 自分の予定業務タイムライン（読取）
- 実績タイムライン（クリックで入力）⭐
- 業務別実績入力欄（件数/点数/郵送点数）⭐
- チーム全体タイムライン（予定/実績）

---

### 10.2 📅 月次カレンダー `/calendar`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 月次スケジュール | `getMonthlySchedules()` | `schedule_monthly` | `MonthlySchedule[]` |
| 業務マスタ | `getTaskDefinitions()` | `schedule_task_defs` | `TaskDefinition[]` |
| 固定業務リスト | `getFixedTasks()` | `schedule_fixed_tasks` | `string[]` |
| 固定業務デフォルト | `getFixedTaskDefaults()` | `schedule_fixed_task_defaults` | `Record<taskName, {plannedCount, minutesPerUnit}>` |

#### COMPUTE
- `getMondayOfWeek(year, month, day)`：その日の月曜の日付（'YYYY-MM-DD'）
- `getOLForDay(year, month, day, dayOfWeek)`：平日のみ、`OL_ASSIGNMENTS[monday]` を返す
- `tasksByCategory`：業務マスタをカテゴリ別にグルーピング
- 期間追加：`startDay 〜 endDay` の各日に同じ taskName で `MonthlySchedule` を生成（重複は除外）
- 「★固定業務」を選んだ日：日次業務入力で `getFixedTasks()` の全業務を自動展開

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| スケジュール追加 | `setMonthlySchedules([...existing, new])` | `schedule_monthly` | `MonthlySchedule` |
| 期間一括追加 | `setMonthlySchedules` | `schedule_monthly` | 複数日に同 taskName |
| スケジュール削除 | `setMonthlySchedules(filtered)` | `schedule_monthly` | id除外 |
| 日別コピー＆ペースト | `setMonthlySchedules` | `schedule_monthly` | source日 → target日 |
| 業務マスタ追加 | `setTaskDefinitions` | `schedule_task_defs` | 新 `TaskDefinition` |
| 業務マスタ削除 | `setTaskDefinitions(filtered)` | `schedule_task_defs` | 名前除外 |
| 固定業務 ON/OFF | `setFixedTasks(updated)` | `schedule_fixed_tasks` | 配列追加/削除 |
| 固定業務件数編集 | `setFixedTaskDefaults` | `schedule_fixed_task_defaults` | `{taskName: {plannedCount, minutesPerUnit}}` |

#### SECTIONS
- 月切替ナビ（前月/次月）
- カレンダーグリッド（日ごとに業務チップ）
- 各日セル：OL担当チップ + 業務追加ボタン
- 業務追加フォーム（プルダウン/直接入力 + 期間指定）
- 業務マスタ管理パネル（折り畳み）
- ★固定業務マスタ管理パネル（折り畳み）

---

### 10.3 📝 日次業務入力 `/daily`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 日次タスク（当日）| `getDailyTasks().filter(t => t.date === selectedDate)` | `schedule_daily_tasks` | `DailyTask[]` |
| 業務マスタ | `getTaskDefinitions()` | `schedule_task_defs` | `TaskDefinition[]` |
| 月次スケジュール | `getMonthlySchedules()` | `schedule_monthly` | `MonthlySchedule[]` |
| 引き継ぎ（承認済） | `getHandovers().filter(h => approved/shared && targetDate === selectedDate)` | `schedule_handovers` | `HandoverRequest[]` |
| シフト | `getShifts()` | `schedule_shifts` | `ShiftEntry[]` |
| 予定タイムライン | `getTimelineForDate(selectedDate)` | `schedule_timeline` | `Record<memberId, Record<blockIdx, taskName>>` |
| 実績タイムライン | `getActualTimelineForDate(selectedDate)` | `schedule_actual_timeline` | 同上 |
| 実績パフォーマンス | `getActualPerformanceForDate(selectedDate)` | `schedule_actual_performance` | 詳細は10.1参照 |
| 業務割当設定 | `getTaskAssignments()` | `schedule_task_assignments` | `Record<taskName, TaskAssignmentConfig>` |
| 固定業務 | `getFixedTasks() / getFixedTaskDefaults()` | `schedule_fixed_tasks` 系 | — |

#### COMPUTE
- `syncMonthlyTasks()`：月次予定 + 承認引き継ぎ → 日次タスクに自動展開（固定業務は `fixedTaskDefaults` で件数・時間初期化）
- `sortTasks(taskList)`：引き継ぎ最上位 → `PRIORITY_TASK_ORDER` → id昇順
- `memberTimelineSummary`：メンバー別の `予定分 / 実績分 / 残り分 / シフト分`
- 必要時間合計 = `Σ(plannedCount × minutesPerUnit)`
- 利用可能リソース合計 = `Σ(shift end - shift start)`
- 部門別ランキング（振り返り）：
  - 評価対象 = 対応可能メンバー登録あり × `speedRatings[業務] > 0` × `actualMinutes > 0` × `actualPoints > 0`
  - 並び順 = `actualSpeed - targetSpeed` 昇順

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| タスク追加 | `setDailyTasks([...all, new])` | `schedule_daily_tasks` | `DailyTask` |
| タスク編集（件数/時間/担当）| `setDailyTasks(updated)` | `schedule_daily_tasks` | DailyTask置換 |
| タスク削除 | `setDailyTasks(filtered)` | `schedule_daily_tasks` | id除外 |
| 前日コピー | `setDailyTasks(updated)` | `schedule_daily_tasks` | 前日属性で複製 |
| 対応可能メンバー設定 | `setTaskAssignments(updated)` | `schedule_task_assignments` | `[業務].assignableMemberIds` |
| 実施時間設定 | `setTaskAssignments` | `schedule_task_assignments` | `[業務].scheduledRanges` |
| 対応人数設定 | `setTaskAssignments` | `schedule_task_assignments` | `[業務].assigneeCount` |
| ピッカー内：個人スピード入力 | `setMembers(updated)` | `schedule_members` | `member.speedRatings[業務] = 分/単位` |
| 実績集計タブ：タイムライン塗り | `setTimelineForDate(date, blocks)` | `schedule_timeline` | `Record<memberId, Record<blockIdx, taskName>>` |

#### SECTIONS
- タブ：**予定入力 / 実績集計 / 振り返り**
- 予定入力：業務×指標マトリックス + 対応可能メンバーピッカー + 実施時間 + 対応人数
- 実績集計：個人別タイムライン（メンバー × 56ブロック）
- 振り返り：部門別ランキング + 予定vsタイムラインGAP + 個人別GAP

---

### 10.4 📆 シフト一覧 `/shifts`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| シフト | `getShifts()` | `schedule_shifts` | `ShiftEntry[]` |
| メンバー | `useAppContext().members` | `schedule_members` | `Member[]` |

#### COMPUTE
- 月の日数/曜日マップ生成
- 週間デフォルト適用：月切替時、各メンバーの空欄日に `member.defaultShifts[dow]` から自動シフト追加
- シフト集計：メンバー別の出勤日数・合計時間（社員/アルバイト分離）

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| シフト追加（プリセット）| `setShifts([...all, new])` | `schedule_shifts` | `ShiftEntry {date, memberId, startTime, endTime}` |
| シフト編集 | `setShifts(updated)` | `schedule_shifts` | 該当置換 |
| シフト削除 | `setShifts(filtered)` | `schedule_shifts` | id除外 |
| 翌日コピー | `setShifts` | `schedule_shifts` | 同 startTime/endTime を翌日に複製 |
| 週間デフォルト設定 | `setMembers(updated)` | `schedule_members` | `member.defaultShifts[dow] = {start, end}` |

#### SECTIONS
- 週間デフォルトパターン編集（メンバー × 曜日のマトリックス）
- 月次シフトグリッド（メンバー × 日付）
- シフト集計（社員/アルバイト別、出勤日数+合計時間）

---

### 10.5 👥 メンバー管理 `/members`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| メンバー | `getMembers()` | `schedule_members` | `Member[]` |
| 業務マスタ | `getTaskDefinitions()` | `schedule_task_defs` | `TaskDefinition[]` |
| 固定業務 | `getFixedTasks() / getFixedTaskDefaults()` | `schedule_fixed_tasks` 系 | — |

#### COMPUTE
- `tasksByCategory`：業務マスタをカテゴリ分類
- メンバーの社員/アルバイト分離（`role`）
- マトリックスのセル：`member.speedRatings[業務]` または `member.priorityRatings[業務]`

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| スキル追加/削除（チェック）| `setMembers(updated)` | `schedule_members` | `member.skills[]` |
| 速度（マトリックス・インライン）| `setMembers(updated)` | `schedule_members` | `member.speedRatings[業務] = 分/単位` |
| 優先順位（マトリックス・インライン）| `setMembers(updated)` | `schedule_members` | `member.priorityRatings[業務] = 数値` |
| 実施時間帯設定 | `setMembers` | `schedule_members` | `member.scheduledTimeRatings[業務] = ['09:00-10:00', ...]` |
| 右クリック：対応不可化 | `setMembers` | `schedule_members` | `skills` から削除 + `speedRatings/priorityRatings/scheduledTimeRatings` 該当キー削除 |
| 固定業務追加/削除 | `setFixedTasks(updated)` | `schedule_fixed_tasks` | `string[]` |
| 固定業務デフォルト値編集 | `setFixedTaskDefaults` | `schedule_fixed_task_defaults` | `{taskName: {plannedCount, minutesPerUnit}}` |

#### SECTIONS
- ⚡ スキル・優先順位マトリックス（紫枠、ページ最上部）
- メンバーカード（社員/アルバイト別）：スキル一覧と各業務の速度/優先度/実施時間
- ★固定業務マスタ管理（折り畳み）

---

### 10.6 📦 郵送点数 `/shipping`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 郵送レコード（当日）| `getShippingRecords().filter(r => r.date === selectedDate)` | `schedule_shipping` | `ShippingRecord[]` |
| 全郵送レコード（持ち越し検出用）| `getShippingRecords()` | `schedule_shipping` | 同上 |
| 日次タスク（リソース計算用）| `getDailyTasks()` | `schedule_daily_tasks` | `DailyTask[]` |
| 実績パフォーマンス（同期反映用）| `getActualPerformanceForDate(selectedDate)` | `schedule_actual_performance` | — |
| メンバー | `useAppContext().members` | `schedule_members` | `Member[]` |

#### COMPUTE
- **自動持ち越し** (`useEffect`)：
  - `selectedDate === today` チェック
  - 前日の `creator` 空のレコードを抽出
  - 既に持ち越し済み（`carriedFromId` で判定）を除外
  - 持ち越しID：`carry-${selectedDate}-${元id}`（決定的）
  - 当日に追加、前日からは削除
- 当日/両日別集計：予定件数/点数 vs 実績件数/点数 → 残件数/点数/リソース（点数×2分）
- 配送業者別集計（`CARRIERS` ループ）
- 個人別集計（`creator` フィールドベース）

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| 自動持ち越し | `setShippingRecords([..filtered, ...toAdd])` | `schedule_shipping` | 前日削除 + 当日追加 |
| レコード追加 | `setShippingRecords([...all, new])` | `schedule_shipping` | `ShippingRecord` |
| レコード編集（配送業者/点数/作成者等）| `setShippingRecords(updated)` | `schedule_shipping` | 該当置換 |
| レコード削除 | `setShippingRecords(filtered)` | `schedule_shipping` | id除外 |
| 作成者入力 | `setShippingRecords + syncCreatorToPerformance()` | `schedule_shipping` + `schedule_actual_performance` | `creator` 名 → メンバーIDの計算書作成 count/points に同期 |

#### SECTIONS
- 実査定予定 & 残りリソース（4カード上部）
- 進捗サマリー（当日/両日/合計、件数+点数の進捗バー）
- 配送業者別集計テーブル
- 個人別集計（作成者ベース）
- 予定/実績テーブル（左右2分割）

---

### 10.7 📨 共有BOX `/handover`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 引き継ぎ・重要案件 | `getHandovers()` | `schedule_handovers` | `HandoverRequest[]` |
| メンバー別タスク | `getMemberTasks()` | `schedule_member_tasks` | `MemberTask[]` |
| 業務マスタ | `getTaskDefinitions()` | `schedule_task_defs` | `TaskDefinition[]` |
| 月次スケジュール（反映用）| `getMonthlySchedules()` | `schedule_monthly` | `MonthlySchedule[]` |

#### COMPUTE
- `type` フィールドで「引き継ぎ」「重要案件」分離（未設定は handover 扱い）
- `targetDate` 降順グループ化
- 表示対象：`status === 'shared' | 'approved'`
- 過去日は折り畳み（初期は閉じる）
- メンバー別タスク：
  - フィルタ：担当者 / ステータス
  - 「全ステータス」時はデフォルトで `completed` を非表示（`mtShowCompleted = false`）
  - ソート：`priority(high→medium→low)` → `plannedCompletionDate` 昇順

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| 新規引き継ぎ共有 | `setHandovers([...all, new])` | `schedule_handovers` | `HandoverRequest {type: 'handover', status: 'shared'}` |
| 新規重要案件共有 | `setHandovers` | `schedule_handovers` | `HandoverRequest {type: 'important', status: 'shared'}` |
| 編集 | `setHandovers(updated)` | `schedule_handovers` | 該当置換 |
| 削除 | `setHandovers(filtered)` | `schedule_handovers` | id除外 |
| 完了チェック | `setHandovers` | `schedule_handovers` | `completed: true/false` |
| 月次に反映 | `setMonthlySchedules` | `schedule_monthly` | 引き継ぎ業務を月次に転記 |
| メンバータスク追加 | `setMemberTasks([...all, new])` | `schedule_member_tasks` | `MemberTask`（担当者は任意） |
| メンバータスク編集 | `setMemberTasks(updated)` | `schedule_member_tasks` | 該当置換 |
| メンバータスク削除 | `setMemberTasks(filtered)` | `schedule_member_tasks` | id除外 |
| ステータス変更 | `setMemberTasks` | `schedule_member_tasks` | `status: 'pending'|'in_progress'|'completed'` |

#### SECTIONS
- タブ：**新規共有 / 引き継ぎ一覧 / 重要案件一覧 / メンバー別タスク**
- 新規共有：サブタブで「引き継ぎ」「重要タスク」切替
- 引き継ぎ・重要案件一覧：日付グループ化、過去は折り畳み
- メンバー別タスク：担当者/ステータスフィルタ + 「完了も表示」チェック

---

### 10.8 🤖 AI自動割振 `/auto-assign`

#### READ
| データ | 取得関数 | ストレージキー | 型 |
|------|--------|------------|---|
| 日次タスク（当日）| `getDailyTasks().filter(t => t.date === selectedDate)` | `schedule_daily_tasks` | `DailyTask[]` |
| シフト（当日）| `getShifts().filter(s => s.date === selectedDate)` | `schedule_shifts` | `ShiftEntry[]` |
| 業務割当設定 | `getTaskAssignments()` | `schedule_task_assignments` | `Record<taskName, TaskAssignmentConfig>` |
| 休憩スロット設定 | `getBreakSlotsForDate(selectedDate)` | `schedule_break_slots` | `Record<memberId, 'early'|'late'|'skip'>` |
| メンバー | `useAppContext().members` | `schedule_members` | `Member[]` |

#### COMPUTE
- `runAutoAssignAlgorithm(tasks, activeMembers, shifts, breakSlotsMap)` — 4ステップ：
  1. **休憩割当**：休憩窓 12:00-14:30、`'early'`=blocks 16-19、`'late'`=blocks 21-24、`'skip'`はスキップ
  2. **実施時間タスク配置**：`taskAssignments[業務].scheduledRanges` がある業務を `plannedMinutes` でキャップして配置、速度重み配分
  3. **残りタスク準備**：assignableTasks 配列に分類
  4. **配分**：Pass1=上位N名で速度重み配分、Pass2=GAPあれば全対応可能メンバー、Pass3=`assigneeCount` 未設定なら最も空き多いメンバー
- 速度重み：`1 / max(member.speedRatings[業務] || defaultSpeed, 0.1)`
- 周期タスク（`PERIODIC_TASKS = ['【LINE】LINE整理', '【LINE】要対応']`）：3ブロック（45分）ギャップ
- `getDefaultBreakSlot(memberName)`：名前から既定スロット推定（潮田/国兼/三原/石井='early'、和田/熊谷/鈴木='late'）

#### WRITE
| アクション | 関数 | 保存先キー | データ形 |
|---------|-----|---------|--------|
| 自動割振実行（即反映）| `setTimelineForDate(date, result) + setDailyTasks(updated)` | `schedule_timeline` + `schedule_daily_tasks` | タイムライン更新 + 各 `dailyTask.assigneeId` に最多担当メンバー設定 |
| 休憩スロット変更 | `setBreakSlotForDate(date, memberId, slot)` | `schedule_break_slots` | `[date][memberId] = 'early'|'late'|'skip'` |

#### SECTIONS
- データ連携バナー（紫）
- AI自動割振の仕組み（Step 1-7解説）
- 条件設定：休憩スロット選択（メンバーごとに早/遅/なし）
- ステータスカード（出勤者・タスク数・必要時間・総リソース）
- 割振対象タスク表
- 実行ボタン
- 警告：割振不可タスク
- プレビュー：メンバー別サマリ + タイムラインビジュアル + 業務内訳

---

### 10.9 🔍 診断ページ `/admin/diagnostic`

#### READ
| データ | 取得関数 | Firestore Path | 型 |
|------|--------|---------|---|
| 全 SYNC_KEYS の Firestore データ | `getDoc(doc(db, 'appData', key))` | `appData/{key}` | `{value, updatedAt}` |
| バックアップ一覧 | `listBackups()` | `appDataBackups/{YYYY-MM-DD}` | `BackupSummary[]` |
| バックアップ詳細 | `getBackup(date)` | 同上 | `Record<key, value>` |

#### COMPUTE
- 月別日別データ存在状況：
  - `perfMemberCount`：その日の `actualPerformance` にエントリがあるメンバー数
  - `perfTaskCount`：そのメンバーの `count>0 || points>0` のタスク数
  - `tlMemberCount`：その日の `actualTimeline` にブロックがあるメンバー数
  - `tlBlockCount`：その日の総ブロック数
  - `dailyTaskCount`：その日の `DailyTask` 数
  - `dailyTaskActualMinutes`：その日の `DailyTask.actualMinutes` 合計
- JSON ダウンロード生成（全データを1ファイルに）

#### WRITE
| アクション | 関数 | 保存先 | データ形 |
|---------|-----|---------|--------|
| 手動バックアップ作成 | `createManualBackup()` | `appDataBackups/{today}` | 全 SYNC_KEYS のスナップショット |
| バックアップから復元（replace）| `restoreKeyFromBackup(date, key, 'replace')` | `appData/{key}` | バックアップ値で完全上書き |
| バックアップから復元（merge）| `restoreKeyFromBackup(date, key, 'merge')` | `appData/{key}` | 現在値を優先しつつバックアップで穴埋め |

#### SECTIONS
- Firestore 各キーの状態テーブル（存在/最終更新/サイズ）
- 月別日別データ存在状況テーブル（赤背景=タイムライン未記録）
- 🗄️ 自動バックアップ管理
  - 保存済みバックアップ一覧
  - 手動バックアップボタン
  - キー単位の復元 UI（モード選択）
- 生 JSON 表示（actualTimeline / actualPerformance）

---

## 11. データフロー サマリ（一覧）

| 画面 | 主要 READ | 主要 WRITE | ストレージキー（読書） |
|------|---------|----------|---------------------|
| **ホーム** | dailyTasks, actualTimeline, actualPerformance, handovers, shipping, shifts | updateMyActualTimelineBlock, updateMyActualPerformanceEntry, setHandovers | 多数（10.1参照） |
| **月次カレンダー** | monthlySchedules, taskDefinitions, fixedTasks | setMonthlySchedules, setTaskDefinitions, setFixedTasks, setFixedTaskDefaults | `schedule_monthly`, `schedule_task_defs`, `schedule_fixed_tasks*` |
| **日次入力** | dailyTasks, monthlySchedules, handovers, taskAssignments, timeline, members | setDailyTasks, setTaskAssignments, setMembers, setTimelineForDate | 多数（10.3参照） |
| **シフト** | shifts, members | setShifts, setMembers（defaultShifts） | `schedule_shifts`, `schedule_members` |
| **メンバー** | members, taskDefinitions, fixedTasks | setMembers, setFixedTasks, setFixedTaskDefaults | `schedule_members`, `schedule_fixed_tasks*` |
| **郵送点数** | shippingRecords, dailyTasks, actualPerformance | setShippingRecords + syncCreatorToPerformance | `schedule_shipping`, `schedule_actual_performance` |
| **共有BOX** | handovers, memberTasks, taskDefinitions | setHandovers, setMemberTasks, setMonthlySchedules | `schedule_handovers`, `schedule_member_tasks` |
| **自動割振** | dailyTasks, shifts, taskAssignments, breakSlots, members | setTimelineForDate, setDailyTasks, setBreakSlotForDate | `schedule_timeline`, `schedule_daily_tasks`, `schedule_break_slots` |
| **集計画面** ⭐ | **actualTimeline, actualPerformance**, timeline, shifts, dailyTasks（業務名収集用のみ）| 読込専用（書込なし）| `schedule_actual_*` |
| **診断** | 全 Firestore キー、バックアップ | createManualBackup, restoreKeyFromBackup | 全 SYNC_KEYS、`appDataBackups/*` |

⭐ **集計画面の特異性**：
- **書込なし** — 表示専用
- **`actualTimeline` と `actualPerformance` のみ**を集計対象とする（`dailyTask.actual*` は使わない）
- 開いた瞬間 + 60秒ごとに `forceRefresh()` で Firestore から強制再取得
- 手動同期ボタン「🔄 最新データに同期」あり

---

このSPEC.mdを参照しながら ChatGPT に修正依頼すれば、誤った仮定や見落としを最小化できます。
