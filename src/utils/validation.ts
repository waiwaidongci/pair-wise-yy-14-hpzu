import type { BirdRecord, IssueSeverity, RingGroup, ValidationIssue } from '../types'
import { getLocationDistance } from '../data/mockRecords'
import { normalizeRingCode, parseCoordinate } from './normalization'
import { groupKeyFor } from './ringGroups'

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  error: 0,
  warning: 1,
  review: 2,
}

export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return severity || a.recordId.localeCompare(b.recordId)
  })
}

/** 记录级结论：只依赖单条记录自身（环号格式、鸟种、坐标） */
export function computeRecordIssues(
  record: BirdRecord,
  index: number,
  groupRevision = 1,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const detectedAt = new Date().toISOString()
  const groupKey = record.groupKey ?? groupKeyFor(record)
  const ring = normalizeRingCode(record.rawRingCode)

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
      groupKey,
      groupRevision,
    })
  }

  if (record.scientificName === '待鉴定' || record.speciesCanonical !== record.speciesRaw) {
    const automatic = record.scientificName !== '待鉴定'
    issues.push({
      id: `issue-species-${record.id}`,
      recordId: record.id,
      type: automatic ? 'species_alias' : 'species_unknown',
      severity: automatic ? 'warning' : 'review',
      title: automatic ? '鸟种使用同义名或俗名' : '鸟种待分类',
      description: automatic
        ? `“${record.speciesRaw}”可归一为规范名称“${record.speciesCanonical}”。`
        : `“${record.speciesRaw}”未匹配到鸟种库中的可靠学名。`,
      field: 'speciesRaw',
      currentValue: record.speciesRaw,
      suggestedValue: automatic ? record.speciesCanonical : '',
      suggestion: automatic
        ? `采用规范中文名与学名 ${record.scientificName}。`
        : '请由鉴定人员补充物种或注明仅鉴定至属/科。',
      status: 'open',
      detectedAt,
      groupKey,
      groupRevision,
    })
  }

  if (
    parseCoordinate(record.latitudeRaw, 'latitude') === null ||
    parseCoordinate(record.longitudeRaw, 'longitude') === null
  ) {
    issues.push({
      id: `issue-coordinate-${record.id}`,
      recordId: record.id,
      type: 'coordinate_invalid',
      severity: 'error',
      title: '坐标格式无效',
      description: `纬度“${record.latitudeRaw}”、经度“${record.longitudeRaw}”不能同时转换为有效坐标。`,
      field: 'latitudeRaw',
      currentValue: `${record.latitudeRaw} / ${record.longitudeRaw}`,
      suggestedValue: '',
      suggestion: '根据地点主表补齐十进制度数或标准度分秒格式。',
      status: 'open',
      detectedAt,
      groupKey,
      groupRevision,
    })
  }

  return issues
}

/**
 * 分组级结论：同一环号分组的重复与跳变在一次遍历里、基于同一份成员快照判定，
 * 并盖上同一个分组版本——一条记录同时落在两类问题里时，两个结论不会各算一版。
 */
export function computeGroupIssues(
  groupKey: string,
  members: BirdRecord[],
  revision: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (members.length < 2) return issues
  const detectedAt = new Date().toISOString()
  const years = new Set(members.map((member) => member.observedAt.slice(0, 4)))
  const sources = new Set(members.map((member) => member.source))

  if (years.size > 1 || sources.size > 1) {
    members.forEach((record) => {
      const ring = normalizeRingCode(record.rawRingCode)
      if (!ring.valid) return
      issues.push({
        id: `issue-duplicate-${record.id}`,
        recordId: record.id,
        type: 'ring_duplicate',
        severity: 'error',
        title: sources.size > 1 ? '多来源环号重复' : '跨年份重复环号',
        description: `归一化环号 ${record.normalizedRingCode} 在 ${years.size} 个年度、${sources.size} 个来源中共出现 ${members.length} 次。`,
        field: 'normalizedRingCode',
        currentValue: record.normalizedRingCode,
        suggestedValue: `${ring.normalizedPrefix}-${record.observedAt.slice(0, 4)}-${String((Number(ring.serial) + 710) % 99999).padStart(5, '0')}`,
        suggestion: '核对原环照片或捕获登记表；确认非重捕记录后更换序列号。',
        status: 'open',
        detectedAt,
        groupKey,
        groupRevision: revision,
      })
    })
  }

  const ordered = [...members].sort(
    (a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id),
  )
  for (let position = 1; position < ordered.length; position += 1) {
    const previous = ordered[position - 1]
    const record = ordered[position]
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
        groupKey,
        groupRevision: revision,
      })
    }
  }

  return issues
}

export function validateRecords(
  records: BirdRecord[],
  groups: Record<string, RingGroup>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  records.forEach((record, index) => {
    const groupKey = record.groupKey ?? groupKeyFor(record)
    issues.push(...computeRecordIssues(record, index, groups[groupKey]?.revision ?? 1))
  })

  const byKey = new Map<string, BirdRecord[]>()
  records.forEach((record) => {
    const key = record.groupKey ?? groupKeyFor(record)
    const list = byKey.get(key) || []
    list.push(record)
    byKey.set(key, list)
  })
  byKey.forEach((members, key) => {
    issues.push(...computeGroupIssues(key, members, groups[key]?.revision ?? 1))
  })

  return sortIssues(issues)
}

export function countBySeverity(issues: ValidationIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1
      return counts
    },
    { error: 0, warning: 0, review: 0 },
  )
}

export function applyIssueSuggestion(record: BirdRecord, issue: ValidationIssue): BirdRecord {
  if (!issue.suggestedValue) return record
  if (issue.field === 'rawRingCode') {
    const ring = normalizeRingCode(issue.suggestedValue)
    return {
      ...record,
      rawRingCode: issue.suggestedValue,
      normalizedRingCode: ring.normalized,
      ringScheme: ring.scheme,
    }
  }
  if (issue.field === 'speciesRaw') {
    const species = record.scientificName
    return {
      ...record,
      speciesRaw: issue.suggestedValue,
      speciesCanonical: issue.suggestedValue,
      scientificName: species,
    }
  }
  if (issue.field === 'location') {
    return { ...record, location: issue.suggestedValue }
  }
  if (issue.field === 'normalizedRingCode') {
    const ring = normalizeRingCode(issue.suggestedValue)
    return {
      ...record,
      rawRingCode: issue.suggestedValue,
      normalizedRingCode: ring.normalized,
      ringScheme: ring.scheme,
    }
  }
  return record
}
