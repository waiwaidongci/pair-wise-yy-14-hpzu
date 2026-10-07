import type { BirdRecord, RecalcJob, RingGroup, ValidationIssue } from '../types'
import { computeGroupIssues } from './validation'
import { GROUP_SCOPED_TYPES, groupFingerprint, groupKeyFor, groupMembers } from './ringGroups'

export interface RecalcStats {
  /** 依据未变、跳过的分组数 */
  unchanged: number
  /** 实际重算的分组数 */
  recalculated: number
  /** 随新值失效的待处理结论数 */
  invalidated: number
  /** 依据变化被退回待复核的已处置结论数 */
  rechecked: number
}

export interface RecalcOutcome {
  issues: ValidationIssue[]
  groups: Record<string, RingGroup>
  job: RecalcJob
  stats: RecalcStats
}

export interface RecalcInput {
  records: BirdRecord[]
  issues: ValidationIssue[]
  groups: Record<string, RingGroup>
  /** 受影响的分组（旧分组与新分组都要在队列里） */
  queue: string[]
  cause: string
  /** 传入失败任务即进入重试：已完成的分组直接接上，不再重算 */
  job?: RecalcJob
  /** 本次操作自己落下的结论（如批量修正的 corrected），不参与退回待复核 */
  exemptIds?: Set<string>
}

function emptyStats(): RecalcStats {
  return { unchanged: 0, recalculated: 0, invalidated: 0, rechecked: 0 }
}

/**
 * 把某分组重算出的新结论并入总账：
 * - 待处理的旧结论随分组依据变化一起失效，由新结论替代；
 * - 已处置（接受/退回/修正）的结论依据变了 → 退回待复核，原结论保留在 previousStatus；
 * - 同一记录同一问题已有保留结论时，不再另开一版待处理结论。
 */
function mergeGroupIssues(
  issues: ValidationIssue[],
  groupKey: string,
  fresh: ValidationIssue[],
  revision: number,
  cause: string,
  stats: RecalcStats,
  exemptIds?: Set<string>,
): ValidationIssue[] {
  const freshById = new Map(fresh.map((issue) => [issue.id, issue]))
  const merged: ValidationIssue[] = []

  for (const issue of issues) {
    const inGroup = issue.groupKey === groupKey && GROUP_SCOPED_TYPES.includes(issue.type)
    if (!inGroup) {
      merged.push(issue)
      continue
    }
    if (issue.status === 'open') {
      stats.invalidated += 1
      continue
    }
    if (exemptIds?.has(issue.id)) {
      merged.push(issue)
      continue
    }
    const match = freshById.get(issue.id)
    if (match) freshById.delete(issue.id)
    if (issue.status !== 'recheck') stats.rechecked += 1
    merged.push({
      ...issue,
      ...(match
        ? {
            title: match.title,
            severity: match.severity,
            description: match.description,
            currentValue: match.currentValue,
            suggestedValue: match.suggestedValue,
            suggestion: match.suggestion,
          }
        : {}),
      status: 'recheck',
      previousStatus: issue.status === 'recheck' ? issue.previousStatus : issue.status,
      invalidatedReason: cause,
      groupRevision: revision,
    })
  }

  for (const issue of freshById.values()) merged.push(issue)
  return merged
}

/**
 * 联动重算：按分组逐个结算，每完成一组就写入检查点。
 * 任一分组失败时保留已完成分组的完整结果，任务标记 failed；
 * 重试时带上原任务，从检查点之后的分组继续。
 */
export function runRecalcJob(input: RecalcInput): RecalcOutcome {
  const { records, cause, queue, exemptIds } = input
  const job: RecalcJob = input.job
    ? { ...input.job, status: 'running', error: undefined, cause, queue: [...queue], done: [...input.job.done] }
    : {
        id: crypto.randomUUID(),
        status: 'running',
        cause,
        queue: [...queue],
        done: [],
        startedAt: new Date().toISOString(),
      }
  const done = new Set(job.done)
  const groups: Record<string, RingGroup> = { ...input.groups }
  const stats = emptyStats()
  let issues = input.issues

  try {
    for (const key of queue) {
      if (done.has(key)) continue
      const members = groupMembers(records, key)
      if (members.some((member) => !member.groupKey)) {
        throw new Error(`分组 ${key} 存在缺少分组来源的记录，需先回填再参与重算`)
      }
      const fingerprint = groupFingerprint(members)
      const prior = groups[key]
      if (prior && prior.fingerprint === fingerprint) {
        stats.unchanged += 1
        groups[key] = { ...prior, recordIds: members.map((member) => member.id) }
        job.done.push(key)
        continue
      }
      const revision = (prior?.revision ?? 0) + 1
      const fresh = computeGroupIssues(key, members, revision)
      issues = mergeGroupIssues(issues, key, fresh, revision, cause, stats, exemptIds)
      // 结算后整组共用一版依据：同组待处理/待复核结论（含记录级）对齐到新版本
      issues = issues.map((issue) =>
        issue.groupKey === key && (issue.status === 'open' || issue.status === 'recheck')
          ? { ...issue, groupRevision: revision }
          : issue,
      )
      stats.recalculated += 1
      groups[key] = {
        key,
        recordIds: members.map((member) => member.id),
        revision,
        fingerprint,
        provenance: prior?.provenance ?? 'recalc',
        updatedAt: new Date().toISOString(),
      }
      job.done.push(key)
    }
    job.status = 'done'
  } catch (error) {
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
  }

  return { issues, groups, job, stats }
}

/** 分组账本版本推进（人工结论落账）：重戳该分组待处理结论的版本，避免后续批量修正误伤先到的人工结论 */
export function bumpGroupRevision(
  groups: Record<string, RingGroup>,
  issues: ValidationIssue[],
  groupKeys: Set<string>,
): { groups: Record<string, RingGroup>; issues: ValidationIssue[] } {
  const nextGroups = { ...groups }
  const now = new Date().toISOString()
  groupKeys.forEach((key) => {
    const group = nextGroups[key]
    if (group) nextGroups[key] = { ...group, revision: group.revision + 1, updatedAt: now }
  })
  const nextIssues = issues.map((issue) => {
    if (!issue.groupKey || !groupKeys.has(issue.groupKey)) return issue
    if (issue.status !== 'open' && issue.status !== 'recheck') return issue
    const group = nextGroups[issue.groupKey]
    return group ? { ...issue, groupRevision: group.revision } : issue
  })
  return { groups: nextGroups, issues: nextIssues }
}

/** 变更后收集受影响的分组：记录原来的分组与变更后的分组都要重算 */
export function affectedGroupKeys(before: BirdRecord, after: BirdRecord): string[] {
  return [...new Set([before.groupKey ?? groupKeyFor(before), after.groupKey ?? groupKeyFor(after)])]
}
