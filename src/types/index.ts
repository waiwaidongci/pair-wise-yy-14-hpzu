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
