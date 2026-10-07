export type IssueSeverity = 'error' | 'warning' | 'review'
export type IssueStatus = 'open' | 'accepted' | 'returned' | 'corrected'
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
}

export interface DecisionRecord {
  status: IssueStatus
  reason?: string
  decidedAt: string
  note?: string
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
  /** 判定依据的环号分组键（归一化环号），用于判断改环后依据是否变化 */
  basisRingCode?: string
  /** 依据变化后被重开时，留存的历史处置结论 */
  decisionHistory?: DecisionRecord[]
  /** 依据变化后问题已消除，原结论留存但不再参与待处理计数 */
  superseded?: boolean
  /** 依据变化被重开复核的时间 */
  reopenedAt?: string
}

export type RecalculationStatus = 'idle' | 'failed'

export interface RecalculationState {
  status: RecalculationStatus
  failedAction?: 'batch_fix' | 'manual_edit' | 'rollback'
  failedParams?: Record<string, unknown>
  error?: string
  /** 失败前已提交的上一份完整结果，重试时在此基础上重算 */
  previousComplete?: {
    records: BirdRecord[]
    issues: ValidationIssue[]
  }
}

export interface OperationSnapshot {
  records: BirdRecord[]
  issues: ValidationIssue[]
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
