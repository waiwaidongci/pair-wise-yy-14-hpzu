import { create } from 'zustand'
import { createMockRecords } from '../data/mockRecords'
import type { BirdRecord, IssueSeverity, IssueStatus, OperationLog, ValidationIssue } from '../types'
import { applyIssueSuggestion, validateRecords } from '../utils/validation'
import { normalizeRecord } from '../utils/normalization'

const initialRecords = createMockRecords()
const initialIssues = validateRecords(initialRecords)

interface ValidationState {
  records: BirdRecord[]
  issues: ValidationIssue[]
  operations: OperationLog[]
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

export const useValidationStore = create<ValidationState>((set, get) => ({
  records: initialRecords,
  issues: initialIssues,
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
    if (!candidates.length) return 0
    const snapshot = {
      records: state.records.map((record) => ({ ...record })),
      issues: state.issues.map((issue) => ({ ...issue })),
    }
    const byRecord = new Map<string, ValidationIssue>()
    candidates.forEach((issue) => byRecord.set(issue.recordId, issue))
    const records = state.records.map((record) => {
      const issue = byRecord.get(record.id)
      return issue ? applyIssueSuggestion(record, issue) : record
    })
    const targetIds = new Set(candidates.map((issue) => issue.id))
    let issues = state.issues.map((issue) =>
      targetIds.has(issue.id) ? { ...issue, status: 'corrected' as const } : issue,
    )
    issues = issues.map((issue) => ({ ...issue }))
    set({
      records,
      issues,
      operations: [
        operation('batch_fix', '按规则批量修正', `已处理 ${candidates.length} 条“${candidates[0].title}”问题。`, candidates.length, snapshot),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
    return candidates.length
  },
  acceptIssues: (ids) => {
    const state = get()
    const targetIds = new Set(ids)
    const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
    if (!count) return
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open'
          ? { ...issue, status: 'accepted' as IssueStatus }
          : issue,
      ),
      operations: [
        operation(
          'accept',
          '接受校验问题',
          '已确认原记录符合现场情况，问题作为已说明项移交。',
          count,
          {
            records: state.records.map((record) => ({ ...record })),
            issues: state.issues.map((issue) => ({ ...issue })),
          },
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  returnIssues: (ids, reason) => {
    const state = get()
    const targetIds = new Set(ids)
    const count = state.issues.filter((issue) => targetIds.has(issue.id) && issue.status === 'open').length
    if (!count || !reason.trim()) return
    set({
      issues: state.issues.map((issue) =>
        targetIds.has(issue.id) && issue.status === 'open'
          ? { ...issue, status: 'returned', returnReason: reason.trim() }
          : issue,
      ),
      operations: [
        operation(
          'return',
          '退回来源班组',
          `退回原因：${reason.trim()}`,
          count,
          {
            records: state.records.map((record) => ({ ...record })),
            issues: state.issues.map((issue) => ({ ...issue })),
          },
        ),
        ...state.operations,
      ],
      selectedIssueIds: [],
    })
  },
  updateRecord: (recordId, patch, reason) => {
    const state = get()
    const record = state.records.find((item) => item.id === recordId)
    if (!record) return
    set({
      records: state.records.map((item) =>
        item.id === recordId ? normalizeRecord({ ...item, ...patch }) : item,
      ),
      issues: state.issues.map((issue) =>
        issue.recordId === recordId && issue.status === 'open'
          ? { ...issue, status: 'corrected' }
          : issue,
      ),
      operations: [
        operation(
          'manual_edit',
          '人工编辑记录',
          reason.trim() || `修正 ${record.id} 的问题字段。`,
          1,
          {
            records: state.records.map((item) => ({ ...item })),
            issues: state.issues.map((issue) => ({ ...issue })),
          },
        ),
        ...state.operations,
      ],
    })
  },
  rollback: (operationId) => {
    const state = get()
    const target = state.operations.find((item) => item.id === operationId)
    if (!target || target.rolledBack) return
    set({
      records: target.snapshot.records.map((record) => ({ ...record })),
      issues: target.snapshot.issues.map((issue) => ({ ...issue })),
      operations: state.operations.map((item) =>
        item.id === operationId ? { ...item, rolledBack: true } : item,
      ),
      selectedIssueIds: [],
      selectedRecordIds: [],
    })
  },
  reset: () => {
    const records = createMockRecords()
    set({
      records,
      issues: validateRecords(records),
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
