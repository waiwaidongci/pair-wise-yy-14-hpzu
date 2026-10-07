import { create } from 'zustand'
import { createMockRecords } from '../data/mockRecords'
import type {
  BirdRecord,
  IssueSeverity,
  IssueStatus,
  MutationResult,
  OperationLog,
  RecalcJob,
  RingGroup,
  ValidationIssue,
} from '../types'
import {
  applyIssueSuggestion,
  computeRecordIssues,
  sortIssues,
  validateRecords,
} from '../utils/validation'
import { normalizeRecord } from '../utils/normalization'
import {
  backfillProvenance,
  GROUP_SCOPED_TYPES,
  groupKeyFor,
  needsBackfill,
} from '../utils/ringGroups'
import { affectedGroupKeys, bumpGroupRevision, runRecalcJob, type RecalcStats } from '../utils/recalc'

const seeded = backfillProvenance(createMockRecords(), [], {})
const initialRecords = seeded.records
const initialGroups = seeded.groups
const initialIssues = validateRecords(initialRecords, initialGroups)

interface ValidationState {
  records: BirdRecord[]
  issues: ValidationIssue[]
  groups: Record<string, RingGroup>
  recalcJob: RecalcJob | null
  operations: OperationLog[]
  selectedIssueIds: string[]
  selectedRecordIds: string[]
  setSelectedIssueIds: (ids: string[]) => void
  setSelectedRecordIds: (ids: string[]) => void
  batchFix: (type: ValidationIssue['type']) => MutationResult
  acceptIssues: (ids: string[]) => void
  returnIssues: (ids: string[], reason: string) => void
  updateRecord: (
    recordId: string,
    patch: Partial<BirdRecord>,
    reason: string,
    expectedRevision?: number,
  ) => MutationResult
  rollback: (operationId: string) => void
  retryRecalc: () => void
  reset: () => void
}

function operation(
  action: OperationLog['action'],
  title: string,
  detail: string,
  count: number,
  snapshot: OperationLog['snapshot'],
): OperationLog {
  return {
    id: crypto.randomUUID(),
    action,
    title,
    detail,
    count,
    timestamp: new Date().toISOString(),
    rolledBack: false,
    snapshot,
  }
}

function snapshotOf(
  records: BirdRecord[],
  issues: ValidationIssue[],
  groups: Record<string, RingGroup>,
): OperationLog['snapshot'] {
  return structuredClone({ records, issues, groups })
}

function withGroupKey(record: BirdRecord): BirdRecord {
  return { ...record, groupKey: groupKeyFor(record) }
}

function recalcNote(stats: RecalcStats, backfilled = 0): string {
  const parts: string[] = []
  if (backfilled) parts.push(`回填分组来源 ${backfilled} 条`)
  if (stats.recalculated) parts.push(`联动重算 ${stats.recalculated} 个环号分组`)
  if (stats.invalidated) parts.push(`${stats.invalidated} 条旧结论失效重算`)
  if (stats.rechecked) parts.push(`${stats.rechecked} 条已处置结论退回待复核`)
  return parts.length ? `；${parts.join('，')}。` : ''
}

const ACTIONABLE: IssueStatus[] = ['open', 'recheck']

export const useValidationStore = create<ValidationState>((set, get) => ({
  records: initialRecords,
  issues: initialIssues,
  groups: initialGroups,
  recalcJob: null,
  operations: [],
  selectedIssueIds: [],
  selectedRecordIds: [],
  setSelectedIssueIds: (ids) => set({ selectedIssueIds: ids }),
  setSelectedRecordIds: (ids) => set({ selectedRecordIds: ids }),
  batchFix: (type) => {
    const state = get()
    const candidates = state.issues.filter(
      (issue) => issue.type === type && issue.status === 'open' && issue.suggestedValue,
    )
    if (!candidates.length) return { ok: true, applied: 0 }
    // 并发保护：分组版本已被先到的人工结论推进的候选不再覆盖，跳过并上报
    const applicable: ValidationIssue[] = []
    let skipped = 0
    candidates.forEach((issue) => {
      const group = issue.groupKey ? state.groups[issue.groupKey] : undefined
      if (group && issue.groupRevision !== undefined && issue.groupRevision !== group.revision) {
        skipped += 1
      } else {
        applicable.push(issue)
      }
    })
    if (!applicable.length) {
      return {
        ok: false,
        conflict: skipped > 0,
        skipped,
        message: '所选问题的分组刚被其他页面更新，已保留先到的人工结论',
      }
    }
    const snapshot = snapshotOf(state.records, state.issues, state.groups)
    const byRecord = new Map<string, ValidationIssue>()
    applicable.forEach((issue) => byRecord.set(issue.recordId, issue))
    const affected = new Set<string>()
    const records = state.records.map((record) => {
      const issue = byRecord.get(record.id)
      if (!issue) return record
      const next = withGroupKey(applyIssueSuggestion(record, issue))
      affectedGroupKeys(record, next).forEach((key) => affected.add(key))
      return next
    })
    const targetIds = new Set(applicable.map((issue) => issue.id))
    const issues = state.issues.map((issue) =>
      targetIds.has(issue.id) ? { ...issue, status: 'corrected' as const } : issue,
    )
    const outcome = runRecalcJob({
      records,
      issues,
      groups: state.groups,
      queue: [...affected],
      cause: `按规则批量修正「${applicable[0].title}」`,
      exemptIds: targetIds,
    })
    set({
      records,
      issues: sortIssues(outcome.issues),
      groups: outcome.groups,
      recalcJob: outcome.job.status === 'failed' ? outcome.job : null,
      operations: [
        operation(
          'batch_fix',
          '按规则批量修正',
          `已处理 ${applicable.length} 条“${applicable[0].title}”问题${recalcNote(outcome.stats)}`,
          applicable.length,
          snapshot,
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
    return {
      ok: true,
      applied: applicable.length,
      skipped,
      invalidated: outcome.stats.invalidated,
      rechecked: outcome.stats.rechecked,
    }
  },
  acceptIssues: (ids) => {
    const state = get()
    const targetIds = new Set(ids)
    const targets = state.issues.filter(
      (issue) => targetIds.has(issue.id) && ACTIONABLE.includes(issue.status),
    )
    if (!targets.length) return
    const affectedKeys = new Set(
      targets.map((issue) => issue.groupKey).filter((key): key is string => Boolean(key)),
    )
    // 人工结论落账即推进分组版本：后到的人工/批量修正若基于旧版本，会被拒绝而不是覆盖本结论
    const bumped = bumpGroupRevision(state.groups, state.issues, affectedKeys)
    set({
      issues: bumped.issues.map((issue) =>
        targetIds.has(issue.id) && ACTIONABLE.includes(issue.status)
          ? { ...issue, status: 'accepted' as IssueStatus }
          : issue,
      ),
      groups: bumped.groups,
      operations: [
        operation(
          'accept',
          '接受校验问题',
          '已确认原记录符合现场情况，问题作为已说明项移交。',
          targets.length,
          snapshotOf(state.records, state.issues, state.groups),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  returnIssues: (ids, reason) => {
    const state = get()
    const targetIds = new Set(ids)
    const targets = state.issues.filter(
      (issue) => targetIds.has(issue.id) && ACTIONABLE.includes(issue.status),
    )
    if (!targets.length || !reason.trim()) return
    const affectedKeys = new Set(
      targets.map((issue) => issue.groupKey).filter((key): key is string => Boolean(key)),
    )
    const bumped = bumpGroupRevision(state.groups, state.issues, affectedKeys)
    set({
      issues: bumped.issues.map((issue) =>
        targetIds.has(issue.id) && ACTIONABLE.includes(issue.status)
          ? { ...issue, status: 'returned', returnReason: reason.trim() }
          : issue,
      ),
      groups: bumped.groups,
      operations: [
        operation(
          'return',
          '退回来源班组',
          `退回原因：${reason.trim()}`,
          targets.length,
          snapshotOf(state.records, state.issues, state.groups),
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  updateRecord: (recordId, patch, reason, expectedRevision) => {
    const state = get()
    if (!state.records.some((item) => item.id === recordId)) {
      return { ok: false, message: '记录不存在' }
    }
    // 历史数据缺少分组来源时先回填，再参与联动重算
    let base = state
    let backfilled = 0
    if (needsBackfill(state.records, state.issues, state.groups)) {
      const fill = backfillProvenance(state.records, state.issues, state.groups)
      backfilled = fill.backfilledRecords + fill.backfilledIssues
      base = { ...state, records: fill.records, issues: fill.issues, groups: fill.groups }
    }
    const record = base.records.find((item) => item.id === recordId) as BirdRecord
    const group = record.groupKey ? base.groups[record.groupKey] : undefined
    if (expectedRevision !== undefined && group && group.revision !== expectedRevision) {
      return {
        ok: false,
        conflict: true,
        message: '该环号分组刚被其他页面更新，已保留先到的人工结论，请核对最新值后再保存',
      }
    }
    const snapshot = snapshotOf(base.records, base.issues, base.groups)
    // 直接改归一化环号时同步改写原始环号，再由归一化推导分组
    const normalizedPatch = { ...patch }
    if (patch.normalizedRingCode && !patch.rawRingCode) {
      normalizedPatch.rawRingCode = patch.normalizedRingCode
    }
    const index = base.records.findIndex((item) => item.id === recordId)
    const nextRecord = withGroupKey(normalizeRecord({ ...record, ...normalizedPatch }))
    const records = base.records.map((item) => (item.id === recordId ? nextRecord : item))

    // 记录级结论随新值重算：已解决的标记修正，仍存在的换成新结论
    const revision = base.groups[nextRecord.groupKey as string]?.revision ?? 1
    const freshRecordIssues = computeRecordIssues(nextRecord, index, revision)
    const freshIds = new Set(freshRecordIssues.map((issue) => issue.id))
    let issues = base.issues.map((issue) => {
      const isRecordScoped =
        issue.recordId === recordId &&
        issue.status === 'open' &&
        !GROUP_SCOPED_TYPES.includes(issue.type)
      return isRecordScoped && !freshIds.has(issue.id)
        ? { ...issue, status: 'corrected' as const }
        : issue
    })
    issues = issues.filter(
      (issue) =>
        !(
          issue.recordId === recordId &&
          issue.status === 'open' &&
          !GROUP_SCOPED_TYPES.includes(issue.type)
        ),
    )
    const existingIds = new Set(issues.map((issue) => issue.id))
    issues = [...issues, ...freshRecordIssues.filter((issue) => !existingIds.has(issue.id))]

    // 联动重算：记录原来的分组与落入的新分组一起结算
    const outcome = runRecalcJob({
      records,
      issues,
      groups: base.groups,
      queue: affectedGroupKeys(record, nextRecord),
      cause: `人工编辑记录 ${recordId}`,
    })
    set({
      records,
      issues: sortIssues(outcome.issues),
      groups: outcome.groups,
      recalcJob: outcome.job.status === 'failed' ? outcome.job : null,
      operations: [
        operation(
          'manual_edit',
          '人工编辑记录',
          `${reason.trim() || `修正 ${record.id} 的问题字段。`}${recalcNote(outcome.stats, backfilled)}`,
          1,
          snapshot,
        ),
        ...base.operations,
      ],
    })
    return {
      ok: true,
      applied: 1,
      invalidated: outcome.stats.invalidated,
      rechecked: outcome.stats.rechecked,
    }
  },
  rollback: (operationId) => {
    const state = get()
    const target = state.operations.find((item) => item.id === operationId)
    if (!target || target.rolledBack) return
    // 旧快照可能缺少分组来源：先回填，再按恢复后的值全量重算，保证联动账一致
    const fill = backfillProvenance(
      structuredClone(target.snapshot.records),
      structuredClone(target.snapshot.issues),
      target.snapshot.groups ? structuredClone(target.snapshot.groups) : {},
    )
    const outcome = runRecalcJob({
      records: fill.records,
      issues: fill.issues,
      groups: fill.groups,
      queue: Object.keys(fill.groups),
      cause: `回滚操作「${target.title}」`,
    })
    set({
      records: fill.records,
      issues: sortIssues(outcome.issues),
      groups: outcome.groups,
      recalcJob: outcome.job.status === 'failed' ? outcome.job : null,
      operations: state.operations.map((item) =>
        item.id === operationId ? { ...item, rolledBack: true } : item,
      ),
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  retryRecalc: () => {
    const state = get()
    const job = state.recalcJob
    if (!job || job.status !== 'failed') return
    // 先补齐分组来源，再从上一份完整结果（检查点）继续重算
    const fill = backfillProvenance(state.records, state.issues, state.groups)
    const outcome = runRecalcJob({
      records: fill.records,
      issues: fill.issues,
      groups: fill.groups,
      queue: job.queue,
      cause: job.cause,
      job,
    })
    set({
      records: fill.records,
      issues: sortIssues(outcome.issues),
      groups: outcome.groups,
      recalcJob: outcome.job.status === 'failed' ? outcome.job : null,
    })
  },
  reset: () => {
    const fill = backfillProvenance(createMockRecords(), [], {})
    set({
      records: fill.records,
      issues: validateRecords(fill.records, fill.groups),
      groups: fill.groups,
      recalcJob: null,
      operations: [],
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
}))

export function filterIssues(
  issues: ValidationIssue[],
  filters: {
    severity?: IssueSeverity | 'all'
    status?: IssueStatus | 'all'
    type?: ValidationIssue['type'] | 'all'
    keyword?: string
  },
) {
  const keyword = filters.keyword?.trim().toLowerCase()
  return issues.filter((issue) => {
    if (filters.severity && filters.severity !== 'all' && issue.severity !== filters.severity) return false
    if (filters.status && filters.status !== 'all' && issue.status !== filters.status) return false
    if (filters.type && filters.type !== 'all' && issue.type !== filters.type) return false
    if (
      keyword &&
      !issue.recordId.toLowerCase().includes(keyword) &&
      !issue.title.toLowerCase().includes(keyword) &&
      !issue.description.toLowerCase().includes(keyword)
    )
      return false
    return true
  })
}
