export type IssueSeverity = 'error' | 'warning' | 'review'
export type IssueStatus = 'open' | 'accepted' | 'returned' | 'corrected' | 'recheck'
export type IssueType =
  | 'ring_invalid'
  | 'ring_duplicate'
  | 'species_alias'
  | 'species_unknown'
  | 'coordinate_invalid'
  | 'location_jump'

export interface SpeciesRule {
  canonical: string
  scientificName: string
  aliases: string[]
}

export interface RingScheme {
  prefix: string
  normalizedPrefix: string
  organization: string
  pattern: string
}

export interface BirdRecord {
  id: string
  source: string
  sourceFile: string
  rawRingCode: string
  normalizedRingCode: string
  ringScheme: string
  speciesRaw: string
  speciesCanonical: string
  scientificName: string
  observedAt: string
  location: string
  latitudeRaw: string
  longitudeRaw: string
  latitude: number | null
  longitude: number | null
  recorder: string
  ageCode: string
  sex: string
  remarks: string
  /** 联动账：所属环号分组。历史数据可能缺失，需先回填再参与重算 */
  groupKey?: string
}

export interface ValidationIssue {
  id: string
  recordId: string
  type: IssueType
  severity: IssueSeverity
  title: string
  description: string
  field: keyof BirdRecord
  currentValue: string
  suggestedValue: string
  suggestion: string
  status: IssueStatus
  returnReason?: string
  detectedAt: string
  /** 联动账：结论所属的环号分组 */
  groupKey?: string
  /** 结论所依据的分组版本 */
  groupRevision?: number
  /** 依据变化被退回待复核之前的处置结论（原记录保留在此） */
  previousStatus?: IssueStatus
  /** 被退回待复核的原因（哪次变更使原依据失效） */
  invalidatedReason?: string
}

/** 环号分组账：同一归一化环号串起的跨年回收链 */
export interface RingGroup {
  key: string
  recordIds: string[]
  /** 分组账本版本：成员或处置结论变动时递增，作为并发修正的乐观锁 */
  revision: number
  /** 分组判定依据（成员环号、时间、地点、来源）的指纹，变了才需要重算 */
  fingerprint: string
  /** 分组来源：历史回填或联动重算 */
  provenance: 'backfill' | 'recalc'
  updatedAt: string
}

/** 批量重算任务：按分组逐个结算，失败时保留已完成分组，可重试续算 */
export interface RecalcJob {
  id: string
  status: 'running' | 'failed' | 'done'
  cause: string
  queue: string[]
  /** 检查点：已完成重算的分组，重试时直接接上 */
  done: string[]
  error?: string
  startedAt: string
}

export interface OperationSnapshot {
  records: BirdRecord[]
  issues: ValidationIssue[]
  groups: Record<string, RingGroup>
}

export interface OperationLog {
  id: string
  action: 'batch_fix' | 'accept' | 'return' | 'manual_edit' | 'reset'
  title: string
  detail: string
  count: number
  timestamp: string
  rolledBack: boolean
  snapshot: OperationSnapshot
}

export interface IssueRule {
  type: IssueType
  severity: IssueSeverity
  label: string
  description: string
  correctionMode: 'automatic' | 'manual'
}

/** 变更操作的统一回执：冲突、跳过、退回待复核的数量都要可见 */
export interface MutationResult {
  ok: boolean
  conflict?: boolean
  applied?: number
  skipped?: number
  invalidated?: number
  rechecked?: number
  message?: string
}
