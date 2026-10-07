import type { BirdRecord, ValidationIssue } from '../types'
import { getLocationDistance } from '../data/mockRecords'
import { normalizeRecord, normalizeRingCode } from './normalization'

const SEVERITY_ORDER = { error: 0, warning: 1, review: 2 } as const

/** 环号分组键：归一化环号。空串表示缺少分组来源。 */
export function ringGroupKey(record: BirdRecord): string {
  return record.normalizedRingCode
}

/** 回填缺少分组来源的记录：重新跑归一化，使其能按环号分组。 */
export function backfillRingGrouping(records: BirdRecord[]): BirdRecord[] {
  return records.map((record) => (ringGroupKey(record) ? record : normalizeRecord(record)))
}

/** 按归一化环号建立分组。 */
export function buildRingGroups(records: BirdRecord[]): Map<string, BirdRecord[]> {
  const groups = new Map<string, BirdRecord[]>()
  records.forEach((record) => {
    const key = ringGroupKey(record)
    if (!key) return
    const list = groups.get(key) || []
    list.push(record)
    groups.set(key, list)
  })
  return groups
}

/**
 * 在同一次分组快照上，原子地计算目标记录的全部环号相关结论
 * （环号无效、环号重复、同环号地点跳变）。
 *
 * 重复与跳变共用同一份 ringGroups 与 records 顺序，因此同一条记录
 * 同时落在重复和跳变里时，两个结论依据的是同一份分组数据，不会各算一版。
 */
export function computeRingIssues(
  records: BirdRecord[],
  ringGroups: Map<string, BirdRecord[]>,
  targetIds: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  records.forEach((record, index) => {
    if (!targetIds.has(record.id)) return
    const ring = normalizeRingCode(record.rawRingCode)
    const detectedAt = new Date().toISOString()

    if (!ring.valid) {
      issues.push({
        id: `issue-ring-${record.id}`,
        recordId: record.id,
        type: 'ring_invalid',
        severity: 'error',
        title: '环号格式无法归一化',
        description: `原始环号“${record.rawRingCode}”无法完整识别方案、年份和序列号。`,
        field: 'rawRingCode',
        currentValue: record.rawRingCode,
        suggestedValue: `${ring.normalizedPrefix || 'CN'}-${new Date(record.observedAt).getFullYear()}-${String((index + 1) % 99999).padStart(5, '0')}`,
        suggestion: '根据来源文件年份和原序列尾号补齐标准方案前缀。',
        status: 'open',
        detectedAt,
        basisRingCode: ringGroupKey(record),
      })
    }

    if (ring.valid) {
      const sameRing = ringGroups.get(ringGroupKey(record)) || []
      if (sameRing.length > 1) {
        const otherYears = new Set(sameRing.map((item) => item.observedAt.slice(0, 4)))
        const sourceCount = new Set(sameRing.map((item) => item.source)).size
        if (otherYears.size > 1 || sourceCount > 1) {
          issues.push({
            id: `issue-duplicate-${record.id}`,
            recordId: record.id,
            type: 'ring_duplicate',
            severity: 'error',
            title: sourceCount > 1 ? '多来源环号重复' : '跨年份重复环号',
            description: `归一化环号 ${record.normalizedRingCode} 在 ${otherYears.size} 个年度、${sourceCount} 个来源中共出现 ${sameRing.length} 次。`,
            field: 'normalizedRingCode',
            currentValue: record.normalizedRingCode,
            suggestedValue: `${ring.normalizedPrefix}-${record.observedAt.slice(0, 4)}-${String((Number(ring.serial) + 710) % 99999).padStart(5, '0')}`,
            suggestion: '核对原环照片或捕获登记表；确认非重捕记录后更换序列号。',
            status: 'open',
            detectedAt,
            basisRingCode: ringGroupKey(record),
          })
        }
      }
    }

    const previous = records
      .slice(Math.max(0, index - 30), index)
      .filter((item) => ringGroupKey(item) === ringGroupKey(record))
      .at(-1)
    if (previous) {
      const distance = getLocationDistance(record, previous)
      const days = Math.abs(
        (new Date(record.observedAt).getTime() - new Date(previous.observedAt).getTime()) / 86400000,
      )
      if (distance !== null && distance > 500 && days < 45) {
        issues.push({
          id: `issue-jump-${record.id}`,
          recordId: record.id,
          type: 'location_jump',
          severity: 'warning',
          title: '同环号地点异常跳变',
          description: `与同环号上一条记录相距 ${Math.round(distance)} 公里，间隔仅 ${Math.max(1, Math.round(days))} 天。`,
          field: 'location',
          currentValue: record.location,
          suggestedValue: previous.location,
          suggestion: '核对观察日期、地点和环号；若为回收记录需补充运输或救助信息。',
          status: 'open',
          detectedAt,
          basisRingCode: ringGroupKey(record),
        })
      }
    }
  })

  return issues
}

/** 问题的判定结论签名：标题、说明、当前值、建议值变化即视为依据变化。 */
function findingSignature(issue: ValidationIssue): string {
  return [issue.title, issue.description, issue.currentValue, issue.suggestedValue].join('|')
}

const RING_ISSUE_TYPES = new Set(['ring_invalid', 'ring_duplicate', 'location_jump'])

function reconcileKey(issue: ValidationIssue): string {
  return `${issue.type}:${issue.recordId}`
}

/**
 * 将受影响分组新算出的环号结论与既有结论对账合并：
 * - 依据未变化：保留原处置状态与结论；
 * - 依据变化且原已有人工结论（接受/退回/修正）：退回待复核（open），原结论写入 decisionHistory 留存；
 * - 依据变化且原为待处理：直接采用新结论；
 * - 既有结论在新分组中已不成立：标记 superseded 留存，不删除原记录。
 * 非环号类结论（鸟种、坐标）原样保留。
 */
export function reconcileRingIssues(
  existing: ValidationIssue[],
  freshRingIssues: ValidationIssue[],
  records: BirdRecord[],
  affectedKeys: Set<string>,
): ValidationIssue[] {
  const affectedRecordIds = new Set(
    records.filter((record) => affectedKeys.has(ringGroupKey(record))).map((record) => record.id),
  )

  const existingRing = existing.filter(
    (issue) => RING_ISSUE_TYPES.has(issue.type) && affectedRecordIds.has(issue.recordId),
  )
  const untouched = existing.filter(
    (issue) => !(RING_ISSUE_TYPES.has(issue.type) && affectedRecordIds.has(issue.recordId)),
  )

  const freshByKey = new Map(freshRingIssues.map((issue) => [reconcileKey(issue), issue]))
  const existingByKey = new Map(existingRing.map((issue) => [reconcileKey(issue), issue]))

  const result: ValidationIssue[] = []
  const consumed = new Set<string>()

  for (const fresh of freshRingIssues) {
    const key = reconcileKey(fresh)
    consumed.add(key)
    const prev = existingByKey.get(key)
    if (!prev) {
      result.push({ ...fresh, status: 'open' })
      continue
    }

    const basisChanged =
      (prev.basisRingCode && fresh.basisRingCode && prev.basisRingCode !== fresh.basisRingCode) ||
      findingSignature(prev) !== findingSignature(fresh)

    if (!basisChanged) {
      result.push({ ...prev, basisRingCode: fresh.basisRingCode })
      continue
    }

    const hadDecision = prev.status === 'accepted' || prev.status === 'returned' || prev.status === 'corrected'
    if (hadDecision) {
      result.push({
        ...fresh,
        status: 'open',
        basisRingCode: fresh.basisRingCode,
        returnReason: undefined,
        reopenedAt: new Date().toISOString(),
        decisionHistory: [
          ...(prev.decisionHistory || []),
          {
            status: prev.status,
            reason: prev.returnReason,
            decidedAt: prev.reopenedAt || prev.detectedAt,
            note: '判定依据变化前的处置结论',
          },
        ],
      })
    } else {
      result.push({ ...fresh, status: 'open', basisRingCode: fresh.basisRingCode })
    }
  }

  for (const prev of existingRing) {
    const key = reconcileKey(prev)
    if (consumed.has(key)) continue
    result.push({
      ...prev,
      superseded: true,
      decisionHistory: [
        ...(prev.decisionHistory || []),
        {
          status: prev.status,
          reason: prev.returnReason,
          decidedAt: prev.reopenedAt || prev.detectedAt,
          note: '判定依据变化后问题已消除，原结论留存',
        },
      ],
    })
  }

  return [...untouched, ...result]
}

/**
 * 改环号 / 批量修正 / 回滚后的联动重算：
 * 1. 回填缺少分组来源的记录；
 * 2. 仅对受影响分组（旧组 + 新组）原子重算环号结论；
 * 3. 与既有结论对账，依据变化的处置结论退回待复核并留存原记录。
 */
export function recalculateAffectedGroups(
  records: BirdRecord[],
  issues: ValidationIssue[],
  affectedKeys: Set<string>,
): { records: BirdRecord[]; issues: ValidationIssue[] } {
  const backfilled = backfillRingGrouping(records)
  const groups = buildRingGroups(backfilled)
  const affectedRecordIds = new Set(
    backfilled.filter((record) => affectedKeys.has(ringGroupKey(record))).map((record) => record.id),
  )
  const fresh = computeRingIssues(backfilled, groups, affectedRecordIds)
  const reconciled = reconcileRingIssues(issues, fresh, backfilled, affectedKeys)
  return { records: backfilled, issues: reconciled }
}

/** 重算后按严重度 + 记录编号排序，与初次校验保持一致。 */
export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return severity || a.recordId.localeCompare(b.recordId)
  })
}
