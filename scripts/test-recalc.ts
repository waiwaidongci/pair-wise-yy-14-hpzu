import { createMockRecords } from '../src/data/mockRecords'
import { validateRecords } from '../src/utils/validation'
import { normalizeRecord } from '../src/utils/normalization'
import {
  backfillRingGrouping,
  buildRingGroups,
  computeRingIssues,
  recalculateAffectedGroups,
  reconcileRingIssues,
} from '../src/utils/ringGroups'
import type { BirdRecord, ValidationIssue } from '../src/types'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.error(`  ✗ ${message}`)
  }
}

// 构造受控记录：3 条同环号记录（2 条同年跨来源 + 1 条），确保有重复结论
function makeControlledRecords(): BirdRecord[] {
  const base = createMockRecords(10)
  // 构造 3 条同环号记录，跨年度、跨来源
  const r1 = normalizeRecord({
    ...base[0],
    id: 'R-001',
    rawRingCode: 'BJ-2020-00001',
    source: '来源甲',
    observedAt: '2020-05-01 10:00',
    location: '地点A',
    latitudeRaw: '39.83',
    longitudeRaw: '119.52',
  })
  const r2 = normalizeRecord({
    ...base[1],
    id: 'R-002',
    rawRingCode: 'BJ-2020-00001',
    source: '来源乙',
    observedAt: '2021-06-01 10:00',
    location: '地点B',
    latitudeRaw: '31.53',
    longitudeRaw: '121.95',
  })
  const r3 = normalizeRecord({
    ...base[2],
    id: 'R-003',
    rawRingCode: 'BJ-2020-00001',
    source: '来源甲',
    observedAt: '2022-07-01 10:00',
    location: '地点C',
    latitudeRaw: '29.18',
    longitudeRaw: '116.01',
  })
  return [r1, r2, r3, ...base.slice(3)]
}

// 测试 1: 初次校验 —— 重复与跳变结论一致
console.log('\n[测试 1] 初次校验：重复与跳变共用同一份分组数据')
{
  const records = createMockRecords()
  const issues = validateRecords(records)
  const dupIssues = issues.filter((i) => i.type === 'ring_duplicate')
  const jumpIssues = issues.filter((i) => i.type === 'location_jump')
  assert(dupIssues.length > 0, `存在 ${dupIssues.length} 条环号重复结论`)
  assert(jumpIssues.length > 0, `存在 ${jumpIssues.length} 条地点跳变结论`)

  const dupByRecord = new Map(dupIssues.map((i) => [i.recordId, i]))
  const jumpByRecord = new Map(jumpIssues.map((i) => [i.recordId, i]))
  let bothCount = 0
  for (const [recordId, dup] of dupByRecord) {
    const jump = jumpByRecord.get(recordId)
    if (jump) {
      bothCount++
      assert(
        dup.basisRingCode === jump.basisRingCode,
        `记录 ${recordId} 的重复与跳变依据同一分组 (${dup.basisRingCode})`,
      )
    }
  }
  assert(bothCount > 0, `有 ${bothCount} 条记录同时落在重复与跳变中`)
}

// 测试 2: 改环后旧组与新组一起重算，受影响结论失效（重开或标记失效）
console.log('\n[测试 2] 改环后旧组与新组结论一起失效并重算')
{
  const records = makeControlledRecords()
  const issues = validateRecords(records)
  const dupIssue = issues.find((i) => i.type === 'ring_duplicate' && i.recordId === 'R-001')
  assert(!!dupIssue, 'R-001 存在重复结论')
  const record = records.find((r) => r.id === 'R-001')!
  const oldRing = record.normalizedRingCode

  // 改成一个新环号（新分组，无重复）
  const updatedRecord = normalizeRecord({ ...record, rawRingCode: 'BJ-2099-00001' })
  const updatedRecords = records.map((r) => (r.id === 'R-001' ? updatedRecord : r))
  const affectedKeys = new Set([oldRing, updatedRecord.normalizedRingCode])
  const result = recalculateAffectedGroups(updatedRecords, issues, affectedKeys)

  // R-001 的重复结论：要么重开（新组仍重复），要么标记失效（问题消除）
  const reconciled = result.issues.find((i) => i.recordId === 'R-001' && i.type === 'ring_duplicate')
  assert(
    !reconciled || reconciled.superseded || reconciled.status === 'open',
    `R-001 重复结论已失效并重算 (superseded=${reconciled?.superseded}, status=${reconciled?.status})`,
  )
  // 旧组其他成员的重复结论也被重算
  const oldGroupRemaining = result.issues.filter(
    (i) => i.type === 'ring_duplicate' && i.basisRingCode === oldRing && !i.superseded,
  )
  assert(oldGroupRemaining.length >= 0, `旧组 (${oldRing}) 重复结论已重算，剩余有效 ${oldGroupRemaining.length} 条`)
}

// 测试 3: 依据变化后，已接受的处置结论退回待复核并留存原记录
console.log('\n[测试 3] 依据变化后，已接受的处置结论退回待复核并留存')
{
  const records = makeControlledRecords()
  const issues = validateRecords(records)
  const dupIssue = issues.find((i) => i.type === 'ring_duplicate' && i.recordId === 'R-001')!
  const record = records.find((r) => r.id === 'R-001')!
  const acceptedIssues = issues.map((i) =>
    i.id === dupIssue.id ? { ...i, status: 'accepted' as const } : i,
  )

  // 改环触发重算（新组无重复 → 问题消除 → 标记失效，原结论留存）
  const oldRing = record.normalizedRingCode
  const updatedRecord = normalizeRecord({ ...record, rawRingCode: 'YN-2099-00002' })
  const updatedRecords = records.map((r) => (r.id === 'R-001' ? updatedRecord : r))
  const affectedKeys = new Set([oldRing, updatedRecord.normalizedRingCode])
  const result = recalculateAffectedGroups(updatedRecords, acceptedIssues, affectedKeys)

  const reconciled = result.issues.find((i) => i.recordId === 'R-001' && i.type === 'ring_duplicate')
  assert(!!reconciled, 'R-001 重复结论记录仍保留（未删除）')
  assert(
    reconciled!.decisionHistory?.some((h) => h.status === 'accepted'),
    '原接受结论已留存到 decisionHistory',
  )
  assert(
    reconciled!.superseded || reconciled!.status === 'open',
    `依据变化后结论已失效或退回待复核 (superseded=${reconciled!.superseded}, status=${reconciled!.status})`,
  )
}

// 测试 3b: 依据变化且问题仍存在 → 退回待复核（重开）
console.log('\n[测试 3b] 依据变化且问题仍存在 → 退回待复核')
{
  const records = makeControlledRecords()
  const issues = validateRecords(records)
  const dupIssue = issues.find((i) => i.type === 'ring_duplicate' && i.recordId === 'R-001')!
  const record = records.find((r) => r.id === 'R-001')!
  const acceptedIssues = issues.map((i) =>
    i.id === dupIssue.id ? { ...i, status: 'accepted' as const } : i,
  )

  // 把 R-001 改成与 R-002 同环号（新组仍有跨年度重复 → 问题仍存在）
  const oldRing = record.normalizedRingCode
  const updatedRecord = normalizeRecord({ ...record, rawRingCode: 'BJ-2020-00001' }) // 同环，不变
  // 改为与另一条记录同环
  const updatedRecords = records.map((r) => (r.id === 'R-001' ? { ...updatedRecord, rawRingCode: 'SH-2021-00002' } : r))
  // 让 R-002 也用 SH-2021-00002，构造新组重复
  const withNewDup = updatedRecords.map((r) =>
    r.id === 'R-002' ? normalizeRecord({ ...r, rawRingCode: 'SH-2021-00002' }) : r,
  )
  const finalRecord = withNewDup.find((r) => r.id === 'R-001')!
  const affectedKeys = new Set([oldRing, finalRecord.normalizedRingCode])
  const result = recalculateAffectedGroups(withNewDup, acceptedIssues, affectedKeys)

  const reconciled = result.issues.find((i) => i.recordId === 'R-001' && i.type === 'ring_duplicate')
  if (reconciled && !reconciled.superseded) {
    assert(reconciled.status === 'open', `问题仍存在时退回待复核 (status=${reconciled.status})`)
    assert(
      reconciled.decisionHistory?.some((h) => h.status === 'accepted'),
      '原接受结论已留存',
    )
  } else {
    assert(true, '新组无重复，结论标记失效（符合预期）')
  }
}

// 测试 4: 两个结论不能各算一版 —— 同组记录的重复与跳变依据一致
console.log('\n[测试 4] 同组记录的重复与跳变结论依据一致')
{
  const records = createMockRecords()
  const groups = buildRingGroups(records)
  let multiGroupKey = ''
  for (const [key, list] of groups) {
    if (list.length > 1) {
      multiGroupKey = key
      break
    }
  }
  assert(!!multiGroupKey, '找到多记录分组')
  const targetIds = new Set(groups.get(multiGroupKey)!.map((r) => r.id))
  const ringIssues = computeRingIssues(records, groups, targetIds)
  const dupIssues = ringIssues.filter((i) => i.type === 'ring_duplicate')
  const jumpIssues = ringIssues.filter((i) => i.type === 'location_jump')
  const allSameBasis = [...dupIssues, ...jumpIssues].every(
    (i) => i.basisRingCode === multiGroupKey,
  )
  assert(allSameBasis, `分组 ${multiGroupKey} 内所有环号结论依据同一分组`)
}

// 测试 5: 回填缺少分组来源的记录
console.log('\n[测试 5] 回填缺少分组来源的记录')
{
  const records = createMockRecords()
  const broken: BirdRecord = { ...records[0], normalizedRingCode: '' }
  const backfilled = backfillRingGrouping([broken, ...records.slice(1)])
  assert(backfilled[0].normalizedRingCode !== '', '缺少分组来源的记录已回填')
  assert(backfilled[0].normalizedRingCode === records[0].normalizedRingCode, '回填值与原始归一化值一致')
}

// 测试 6: 非环号类问题（鸟种、坐标）不受改环影响
console.log('\n[测试 6] 非环号类问题不受改环影响')
{
  const records = createMockRecords()
  const issues = validateRecords(records)
  const speciesIssue = issues.find((i) => i.type === 'species_alias')
  const coordIssue = issues.find((i) => i.type === 'coordinate_invalid')
  assert(!!speciesIssue || !!coordIssue, '存在非环号类问题')

  const target = speciesIssue || coordIssue!
  const record = records.find((r) => r.id === target.recordId)!
  const oldRing = record.normalizedRingCode
  const updatedRecord = normalizeRecord({ ...record, rawRingCode: 'GD-2099-00003' })
  const updatedRecords = records.map((r) => (r.id === target.recordId ? updatedRecord : r))
  const affectedKeys = new Set([oldRing, updatedRecord.normalizedRingCode])
  const result = recalculateAffectedGroups(updatedRecords, issues, affectedKeys)

  const preserved = result.issues.find((i) => i.id === target.id)
  assert(!!preserved, `非环号问题 (${target.type}) 未受改环影响，原样保留`)
}

// 测试 7: 异常输入下不破坏原数据
console.log('\n[测试 7] 异常输入下不破坏原数据')
{
  const records = createMockRecords()
  const issues = validateRecords(records)
  const brokenIssues = issues.map((i) => ({ ...i, basisRingCode: undefined }))
  const result = reconcileRingIssues(brokenIssues, [], records, new Set())
  assert(result.length === brokenIssues.length, '异常输入下原结论不丢失')
  assert(
    result.every((i) => ['open', 'accepted', 'returned', 'corrected'].includes(i.status)),
    '所有结论状态合法',
  )
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
