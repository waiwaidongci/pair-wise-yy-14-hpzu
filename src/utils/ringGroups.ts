import type { BirdRecord, IssueType, RingGroup, ValidationIssue } from '../types'

/** 随环号分组联动的结论类型：分组依据一变，这两类结论整组失效重算 */
export const GROUP_SCOPED_TYPES: IssueType[] = ['ring_duplicate', 'location_jump']

/** 记录的所属分组：归一化环号即分组键；无法归一化的记录不进任何回收链 */
export function groupKeyFor(record: BirdRecord): string {
  const key = record.normalizedRingCode?.trim()
  return key || `__ungrouped__:${record.id}`
}

/** 分组判定依据的指纹：成员、环号、时间、地点、来源任一变化都会改变它 */
export function groupFingerprint(members: BirdRecord[]): string {
  return members
    .map((member) =>
      [
        member.id,
        member.normalizedRingCode,
        member.observedAt,
        member.location,
        member.latitude ?? '',
        member.longitude ?? '',
        member.source,
      ].join('|'),
    )
    .sort()
    .join('¶')
}

export function groupMembers(records: BirdRecord[], key: string): BirdRecord[] {
  return records.filter((record) => (record.groupKey ?? groupKeyFor(record)) === key)
}

/** 依据当前记录重建全部分组账（用于初始化与历史数据回填） */
export function buildGroups(records: BirdRecord[]): Record<string, RingGroup> {
  const byKey = new Map<string, BirdRecord[]>()
  records.forEach((record) => {
    const key = record.groupKey ?? groupKeyFor(record)
    const list = byKey.get(key) || []
    list.push(record)
    byKey.set(key, list)
  })
  const groups: Record<string, RingGroup> = {}
  const now = new Date().toISOString()
  byKey.forEach((members, key) => {
    groups[key] = {
      key,
      recordIds: members.map((member) => member.id),
      revision: 1,
      fingerprint: groupFingerprint(members),
      provenance: 'backfill',
      updatedAt: now,
    }
  })
  return groups
}

export interface BackfillResult {
  records: BirdRecord[]
  issues: ValidationIssue[]
  groups: Record<string, RingGroup>
  backfilledRecords: number
  backfilledIssues: number
  createdGroups: number
}

export function needsBackfill(
  records: BirdRecord[],
  issues: ValidationIssue[],
  groups: Record<string, RingGroup>,
): boolean {
  if (records.length && !Object.keys(groups).length) return true
  if (records.some((record) => !record.groupKey)) return true
  return issues.some((issue) => !issue.groupKey)
}

/**
 * 历史数据缺少分组来源时先回填：给记录补 groupKey、给结论补 groupKey/groupRevision、
 * 给缺失的分组建账（provenance = backfill），然后才能参与联动重算。
 */
export function backfillProvenance(
  records: BirdRecord[],
  issues: ValidationIssue[],
  groups: Record<string, RingGroup>,
): BackfillResult {
  let backfilledRecords = 0
  const nextRecords = records.map((record) => {
    if (record.groupKey) return record
    backfilledRecords += 1
    return { ...record, groupKey: groupKeyFor(record) }
  })

  const nextGroups: Record<string, RingGroup> = { ...groups }
  let createdGroups = 0
  const membersByKey = new Map<string, BirdRecord[]>()
  nextRecords.forEach((record) => {
    const key = record.groupKey as string
    const list = membersByKey.get(key) || []
    list.push(record)
    membersByKey.set(key, list)
  })
  const now = new Date().toISOString()
  membersByKey.forEach((members, key) => {
    if (nextGroups[key]) return
    createdGroups += 1
    nextGroups[key] = {
      key,
      recordIds: members.map((member) => member.id),
      revision: 1,
      fingerprint: groupFingerprint(members),
      provenance: 'backfill',
      updatedAt: now,
    }
  })

  const groupByRecordId = new Map(nextRecords.map((record) => [record.id, record.groupKey as string]))
  let backfilledIssues = 0
  const nextIssues = issues.map((issue) => {
    const groupKey = issue.groupKey ?? groupByRecordId.get(issue.recordId)
    if (!groupKey) return issue
    const groupRevision = issue.groupRevision ?? nextGroups[groupKey]?.revision ?? 1
    if (issue.groupKey === groupKey && issue.groupRevision === groupRevision) return issue
    backfilledIssues += 1
    return { ...issue, groupKey, groupRevision }
  })

  return {
    records: nextRecords,
    issues: nextIssues,
    groups: nextGroups,
    backfilledRecords,
    backfilledIssues,
    createdGroups,
  }
}
