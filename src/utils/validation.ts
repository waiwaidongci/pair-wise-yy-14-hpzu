import type { BirdRecord, IssueSeverity, ValidationIssue } from '../types'
import { normalizeRingCode, parseCoordinate } from './normalization'
import { buildRingGroups, computeRingIssues, sortIssues } from './ringGroups'

export function validateRecords(records: BirdRecord[]): ValidationIssue[] {
  const ringGroups = buildRingGroups(records)
  const allIds = new Set(records.map((record) => record.id))
  const ringIssues = computeRingIssues(records, ringGroups, allIds)

  const issues: ValidationIssue[] = [...ringIssues]

  records.forEach((record) => {
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
          : '请由鉴定人员补充物种或注明仅鉴定至属或科。',
        status: 'open',
        detectedAt: new Date().toISOString(),
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
        detectedAt: new Date().toISOString(),
      })
    }
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
