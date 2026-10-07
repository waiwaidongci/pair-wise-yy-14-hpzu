import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createMockRecords } from '../data/mockRecords'
import type {
  BirdRecord,
  IssueSeverity,
  IssueStatus,
  OperationLog,
  RecalculationState,
  ValidationIssue,
} from '../types'
import { applyIssueSuggestion, validateRecords } from '../utils/validation'
import { normalizeRecord } from '../utils/normalization'
import { backfillRingGrouping, recalculateAffectedGroups, sortIssues } from '../utils/ringGroups'

const PERSIST_KEY = 'yanji-ring-validation'

const initialRecords = backfillRingGrouping(createMockRecords())
const initialIssues = validateRecords(initialRecords)

interface ValidationState {
  records: BirdRecord[]
  issues: ValidationIssue[]
  operations: OperationLog[]
  dataVersion: number
  recalculationState: RecalculationState
  selectedIssueIds: string[]
  selectedRecordIds: string[]
  setSelectedIssueIds: (ids: string[]) => void
  setSelectedRecordIds: (ids: string[]) => void
  batchFix: (type: ValidationIssue['type']) => number
  acceptIssues: (ids: string[]) => void
  returnIssues: (ids: string[], reason: string) => void
  updateRecord: (recordId: string, patch: Partial<BirdRecord>, reason: string) => void
  rollback: (operationId: string) => void
  reset: () => void
  retryRecalculation: () => void
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

function snapshotOf(records: BirdRecord[], issues: ValidationIssue[]) {
  return {
    records: records.map((record) => ({ ...record })),
    issues: issues.map((issue) => ({ ...issue })),
  }
}

/** 直接读取本地持久化的最新状态，用于提交前校验其他页面是否已写入。 */
function readPersistedState(): { state?: Partial<ValidationState> } | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    return JSON.parse(raw) as { state?: Partial<ValidationState> }
  } catch {
    return null
  }
}

interface ComputeResult {
  records: BirdRecord[]
  issues: ValidationIssue[]
  operation: OperationLog
}

/**
 * 联动提交：在提交前读取本地最新版本，若其他页面已写入更高版本，
 * 则在最新状态上重放本次修改，避免后到的修正盖掉先到的人工结论。
 * 若重算抛错，则恢复到上一份完整结果并记录失败，供重试。
 */
function withRebase(
  set: (partial: Partial<ValidationState>) => void,
  get: () => ValidationState,
  compute: (state: ValidationState) => ComputeResult | null,
  meta: { action: RecalculationState['failedAction']; params: Record<string, unknown> },
) {
  const state = get()
  const baseVersion = state.dataVersion
  try {
    const result = compute(state)
    if (!result) return
    const latest = readPersistedState()
    let finalResult = result
    let finalVersion = baseVersion + 1
    if (
      latest?.state &&
      typeof latest.state.dataVersion === 'number' &&
      latest.state.dataVersion > baseVersion
    ) {
      const rebased = compute({ ...state, ...latest.state })
      if (rebased) {
        finalResult = rebased
        finalVersion = latest.state.dataVersion + 1
      }
    }
    set({
      records: finalResult.records,
      issues: finalResult.issues,
      operations: [finalResult.operation, ...get().operations],
      dataVersion: finalVersion,
      selectedIssueIds: [],
      selectedRecordIds: [],
      recalculationState: { status: 'idle' },
    })
  } catch (error) {
    const current = get()
    set({
      records: current.records,
      issues: current.issues,
      recalculationState: {
        status: 'failed',
        failedAction: meta.action,
        failedParams: meta.params,
        error: error instanceof Error ? error.message : String(error),
        previousComplete: { records: current.records, issues: current.issues },
      },
    })
  }
}

export const useValidationStore = create<ValidationState>()(
  persist(
    (set, get) => ({
      records: initialRecords,
      issues: initialIssues,
      operations: [],
      dataVersion: 0,
      recalculationState: { status: 'idle' },
      selectedIssueIds: [],
      selectedRecordIds: [],
      setSelectedIssueIds: (ids) => set({ selectedIssueIds: ids }),
      setSelectedRecordIds: (ids) => set({ selectedRecordIds: ids }),

      batchFix: (type) => {
        const state = get()
        const candidates = state.issues.filter(
          (issue) => issue.type === type && issue.status === 'open' && issue.suggestedValue,
        )
        if (!candidates.length) return 0
        withRebase(
          set,
          get,
          (current) => {
            const candidates = current.issues.filter(
              (issue) => issue.type === type && issue.status === 'open' && issue.suggestedValue,
            )
            if (!candidates.length) return null
            const byRecord = new Map(candidates.map((issue) => [issue.recordId, issue]))
            let records = current.records.map((record) =>
              byRecord.has(record.id) ? applyIssueSuggestion(record, byRecord.get(record.id)!) : record,
            )
            const oldRingCodes = new Set(
              candidates
                .map((issue) => current.records.find((record) => record.id === issue.recordId)?.normalizedRingCode)
                .filter((code): code is string => Boolean(code)),
            )
            const newRingCodes = new Set(
              records
                .filter((record) => byRecord.has(record.id))
                .map((record) => record.normalizedRingCode)
                .filter((code): code is string => Boolean(code)),
            )
            const affectedKeys = new Set([...oldRingCodes, ...newRingCodes])
            const recalculated = recalculateAffectedGroups(records, current.issues, affectedKeys)
            records = recalculated.records
            let issues = recalculated.issues
            // 非环号类问题（鸟种、坐标）直接标记为已修正；环号类由联动重算对账
            if (type !== 'ring_duplicate' && type !== 'location_jump' && type !== 'ring_invalid') {
              const targetIds = new Set(candidates.map((issue) => issue.id))
              issues = issues.map((issue) =>
                targetIds.has(issue.id) ? { ...issue, status: 'corrected' as IssueStatus } : issue,
              )
            }
            return {
              records,
              issues: sortIssues(issues),
              operation: operation(
                'batch_fix',
                '按规则批量修正',
                `已处理 ${candidates.length} 条“${candidates[0].title}”问题。改环后旧组与新组结论已一起重算。`,
                candidates.length,
                snapshotOf(current.records, current.issues),
              ),
            }
          },
          { action: 'batch_fix', params: { type } },
        )
        return candidates.length
      },

      acceptIssues: (ids) => {
        const state = get()
        const targetIds = new Set(ids)
        const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
        if (!count) return
        withRebase(
          set,
          get,
          (current) => {
            const targetIds = new Set(ids)
            const count = current.issues.filter(
              (issue) => targetIds.has(issue.id) && issue.status === 'open',
            ).length
            if (!count) return null
            return {
              records: current.records,
              issues: current.issues.map((issue) =>
                targetIds.has(issue.id) && issue.status === 'open'
                  ? { ...issue, status: 'accepted' as IssueStatus }
                  : issue,
              ),
              operation: operation(
                'accept',
                '接受校验问题',
                '已确认原记录符合现场情况，问题作为已说明项移交。',
                count,
                snapshotOf(current.records, current.issues),
              ),
            }
          },
          { action: 'batch_fix', params: {} },
        )
      },

      returnIssues: (ids, reason) => {
        const state = get()
        const targetIds = new Set(ids)
        const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
        if (!count || !reason.trim()) return
        withRebase(
          set,
          get,
          (current) => {
            const targetIds = new Set(ids)
            const count = current.issues.filter(
              (issue) => targetIds.has(issue.id) && issue.status === 'open',
            ).length
            if (!count || !reason.trim()) return null
            return {
              records: current.records,
              issues: current.issues.map((issue) =>
                targetIds.has(issue.id) && issue.status === 'open'
                  ? { ...issue, status: 'returned', returnReason: reason.trim() }
                  : issue,
              ),
              operation: operation(
                'return',
                '退回来源班组',
                `退回原因：${reason.trim()}`,
                count,
                snapshotOf(current.records, current.issues),
              ),
            }
          },
          { action: 'batch_fix', params: {} },
        )
      },

      updateRecord: (recordId, patch, reason) => {
        const state = get()
        const record = state.records.find((item) => item.id === recordId)
        if (!record) return
        withRebase(
          set,
          get,
          (current) => {
            const record = current.records.find((item) => item.id === recordId)
            if (!record) return null
            const oldRingCode = record.normalizedRingCode
            const updated = normalizeRecord({ ...record, ...patch })
            const newRingCode = updated.normalizedRingCode
            const affectedKeys = new Set([oldRingCode, newRingCode].filter(Boolean))
            const records = current.records.map((item) => (item.id === recordId ? updated : item))
            const recalculated = recalculateAffectedGroups(records, current.issues, affectedKeys)
            return {
              records: recalculated.records,
              issues: sortIssues(recalculated.issues),
              operation: operation(
                'manual_edit',
                '人工编辑记录',
                reason.trim() || `修正 ${record.id} 的问题字段。改环后旧组与新组结论已一起重算。`,
                1,
                snapshotOf(current.records, current.issues),
              ),
            }
          },
          { action: 'manual_edit', params: { recordId, patch, reason } },
        )
      },

      rollback: (operationId) => {
        const state = get()
        const target = state.operations.find((item) => item.id === operationId)
        if (!target || target.rolledBack) return
        withRebase(
          set,
          get,
          (current) => {
            const target = current.operations.find((item) => item.id === operationId)
            if (!target || target.rolledBack) return null
            const currentRingCodes = new Set(
              current.records.map((record) => record.normalizedRingCode).filter((code) => Boolean(code)),
            )
            const snapshotRingCodes = new Set(
              target.snapshot.records.map((record) => record.normalizedRingCode).filter((code) => Boolean(code)),
            )
            const affectedKeys = new Set([...currentRingCodes, ...snapshotRingCodes])
            const recalculated = recalculateAffectedGroups(
              target.snapshot.records,
              target.snapshot.issues,
              affectedKeys,
            )
            return {
              records: recalculated.records,
              issues: sortIssues(recalculated.issues),
              operation: { ...target, rolledBack: true },
            }
          },
          { action: 'rollback', params: { operationId } },
        )
      },

      reset: () => {
        const records = backfillRingGrouping(createMockRecords())
        set({
          records,
          issues: validateRecords(records),
          operations: [],
          dataVersion: 0,
          recalculationState: { status: 'idle' },
          selectedIssueIds: [],
          selectedRecordIds: [],
        })
      },

      retryRecalculation: () => {
        const state = get()
        const failed = state.recalculationState
        if (failed.status !== 'failed') return
        set({ recalculationState: { status: 'idle' } })
        if (failed.failedAction === 'batch_fix' && failed.failedParams?.type) {
          get().batchFix(failed.failedParams.type as ValidationIssue['type'])
        } else if (
          failed.failedAction === 'manual_edit' &&
          failed.failedParams?.recordId &&
          failed.failedParams?.patch
        ) {
          const params = failed.failedParams as unknown as {
            recordId: string
            patch: Partial<BirdRecord>
            reason: string
          }
          get().updateRecord(params.recordId, params.patch, params.reason)
        } else if (failed.failedAction === 'rollback' && failed.failedParams?.operationId) {
          get().rollback(failed.failedParams.operationId as string)
        }
      },
    }),
    {
      name: PERSIST_KEY,
      partialize: (state) => ({
        records: state.records,
        issues: state.issues,
        operations: state.operations,
        dataVersion: state.dataVersion,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return
        // 回填缺少分组来源的记录后再参与后续分组重算
        const records = Array.isArray(rehydratedState.records)
          ? backfillRingGrouping(rehydratedState.records)
          : rehydratedState.records
        useValidationStore.setState({ records })
      },
    },
  ),
)

// 跨页面同步：其他页面写入后，本页面用最新持久化状态覆盖，
// 保证两个页面看到的分组与人工结论一致。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== PERSIST_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue) as { state?: Partial<ValidationState> }
      if (!parsed.state) return
      useValidationStore.setState({
        records: parsed.state.records,
        issues: parsed.state.issues,
        operations: parsed.state.operations,
        dataVersion: parsed.state.dataVersion,
      })
    } catch {
      // 忽略损坏的持久化内容
    }
  })
}

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
