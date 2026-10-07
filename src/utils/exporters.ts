import type { BirdRecord, OperationLog, RingGroup, ValidationIssue } from '../types'

function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function exportRecordsCsv(records: BirdRecord[], issues: ValidationIssue[]) {
  const issueByRecord = new Map<string, ValidationIssue[]>()
  issues
    .filter((issue) => issue.status === 'open' || issue.status === 'recheck')
    .forEach((issue) => {
      issueByRecord.set(issue.recordId, [...(issueByRecord.get(issue.recordId) || []), issue])
    })
  const headers = [
    '记录编号',
    '数据来源',
    '原始文件',
    '原始环号',
    '归一化环号',
    '环志方案',
    '原始鸟种',
    '规范鸟种',
    '学名',
    '观察时间',
    '地点',
    '纬度',
    '经度',
    '环志员',
    '年龄',
    '性别',
    '未解决校验问题',
  ]
  const rows = records.map((record) =>
    [
      record.id,
      record.source,
      record.sourceFile,
      record.rawRingCode,
      record.normalizedRingCode,
      record.ringScheme,
      record.speciesRaw,
      record.speciesCanonical,
      record.scientificName,
      record.observedAt,
      record.location,
      record.latitude ?? '',
      record.longitude ?? '',
      record.recorder,
      record.ageCode,
      record.sex,
      (issueByRecord.get(record.id) || []).map((issue) => issue.title).join('；'),
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(','),
  )
  download(`\uFEFF${[headers.join(','), ...rows].join('\n')}`, '环志移交数据.csv', 'text/csv;charset=utf-8')
}

export function exportTransferJson(
  records: BirdRecord[],
  issues: ValidationIssue[],
  operations: OperationLog[],
  groups: Record<string, RingGroup>,
) {
  const payload = {
    schemaVersion: 'CN-RING-2026.1',
    generatedAt: new Date().toISOString(),
    center: '华东区域鸟类环志中心',
    summary: {
      records: records.length,
      ringGroups: Object.keys(groups).length,
      unresolvedIssues: issues.filter((issue) => issue.status === 'open').length,
      recheckIssues: issues.filter((issue) => issue.status === 'recheck').length,
      correctedIssues: issues.filter((issue) => issue.status === 'corrected').length,
      acceptedIssues: issues.filter((issue) => issue.status === 'accepted').length,
      returnedIssues: issues.filter((issue) => issue.status === 'returned').length,
    },
    records,
    ringGroups: Object.values(groups),
    issues,
    auditTrail: operations.map(({ snapshot: _snapshot, ...operation }) => operation),
  }
  download(JSON.stringify(payload, null, 2), '环志移交数据.json', 'application/json;charset=utf-8')
}

export function exportValidationCsv(issues: ValidationIssue[], records: BirdRecord[]) {
  const recordsById = new Map(records.map((record) => [record.id, record]))
  const headers = ['问题编号', '记录编号', '级别', '类型', '字段', '当前值', '建议值', '状态', '原结论', '失效原因', '返回原因', '原始环号', '鸟种']
  const labels = { error: '错误', warning: '警告', review: '待确认' }
  const statusLabels = {
    open: '待处理',
    accepted: '已接受',
    returned: '已退回',
    corrected: '已修正',
    recheck: '待复核',
  }
  const rows = issues.map((issue) => {
    const record = recordsById.get(issue.recordId)
    return [
      issue.id,
      issue.recordId,
      labels[issue.severity],
      issue.title,
      issue.field,
      issue.currentValue,
      issue.suggestedValue,
      statusLabels[issue.status],
      issue.previousStatus ? statusLabels[issue.previousStatus] : '',
      issue.invalidatedReason || '',
      issue.returnReason || '',
      record?.rawRingCode || '',
      record?.speciesCanonical || '',
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(',')
  })
  download(`\uFEFF${[headers.join(','), ...rows].join('\n')}`, '校验问题清单.csv', 'text/csv;charset=utf-8')
}
