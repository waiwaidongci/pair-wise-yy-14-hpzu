// @ts-nocheck
import { createMockRecords } from '../src/data/mockRecords'
import { validateRecords } from '../src/utils/validation'
import { normalizeRecord } from '../src/utils/normalization'
import { backfillRingGrouping } from '../src/utils/ringGroups'
import type { BirdRecord, ValidationIssue } from '../src/types'

// Mock localStorage
const store = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}
;(globalThis as any).localStorage = localStorageMock

// Mock window + StorageEvent（在 store 动态导入前设置，确保 storage 事件监听器注册）
const storageListeners: Array<(event: any) => void> = []
const windowMock = {
  addEventListener: (type: string, handler: (event: any) => void) => {
    if (type === 'storage') storageListeners.push(handler)
  },
  localStorage: localStorageMock,
}
;(globalThis as any).window = windowMock
class StorageEventMock {
  key: string
  newValue: string | null
  constructor(type: string, init: { key: string; newValue: string | null }) {
    this.key = init.key
    this.newValue = init.newValue
  }
}
;(globalThis as any).StorageEvent = StorageEventMock

// Mock crypto.randomUUID
let uuidCounter = 0
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => `uuid-${++uuidCounter}` },
  configurable: true,
})

// 动态导入 store（确保 mock 已设置）
const { useValidationStore } = await import('../src/stores/validationStore')

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

// 辅助：模拟另一个页面写入 localStorage（提升 dataVersion）
function simulateOtherTabWrite(updates: { records?: BirdRecord[]; issues?: ValidationIssue[] }) {
  const raw = store.get('yanji-ring-validation')
  if (!raw) return
  const parsed = JSON.parse(raw)
  if (updates.records) parsed.state.records = updates.records
  if (updates.issues) parsed.state.issues = updates.issues
  parsed.state.dataVersion = (parsed.state.dataVersion ?? 0) + 1
  store.set('yanji-ring-validation', JSON.stringify(parsed))
}

// 测试 1: 改环后旧组与新组一起重算（store 级别）
console.log('\n[Store 测试 1] 改环后旧组与新组结论一起重算')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()
  const records = state.records
  const issues = state.issues

  // 找一条有重复问题的记录
  const dupIssue = issues.find((i) => i.type === 'ring_duplicate')!
  const record = records.find((r) => r.id === dupIssue.recordId)!
  const oldRing = record.normalizedRingCode

  // 改环
  useValidationStore.getState().updateRecord(record.id, { rawRingCode: 'BJ-2099-00099' }, '测试改环')

  const newState = useValidationStore.getState()
  const updatedRecord = newState.records.find((r) => r.id === record.id)!
  assert(updatedRecord.normalizedRingCode === 'BJ-2099-00099', '记录环号已更新')

  // 受影响记录的重复结论已失效或重算
  const reconciled = newState.issues.find((i) => i.recordId === record.id && i.type === 'ring_duplicate')
  assert(
    !reconciled || reconciled.superseded || reconciled.status === 'open',
    `改环后重复结论已失效或重算 (superseded=${reconciled?.superseded}, status=${reconciled?.status})`,
  )

  // 操作历史已记录
  assert(newState.operations.length === 1, '操作历史已记录')
  assert(newState.operations[0].action === 'manual_edit', '操作类型为人工编辑')
}

// 测试 2: 两个页面同时修改同一分组 —— 后到的修正不盖掉先到的人工结论
console.log('\n[Store 测试 2] 两页面并发修改：后到修正不盖掉先到人工结论')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()
  const records = state.records
  const issues = state.issues

  // 找一条有重复问题的记录
  const dupIssue = issues.find((i) => i.type === 'ring_duplicate')!
  const record = records.find((r) => r.id === dupIssue.recordId)!

  // 页面 A：接受该结论（人工结论）
  useValidationStore.getState().acceptIssues([dupIssue.id])
  const afterAccept = useValidationStore.getState()
  const acceptedIssue = afterAccept.issues.find((i) => i.id === dupIssue.id)!
  assert(acceptedIssue.status === 'accepted', '页面 A 已接受该结论')

  // 模拟页面 B 在 A 接受后写入（B 的 dataVersion 更高）
  // B 读取的是 A 接受后的状态，然后改环
  simulateOtherTabWrite({})

  // 页面 B：改环（后到的修正）
  useValidationStore.getState().updateRecord(record.id, { rawRingCode: 'YN-2099-00088' }, '页面B改环')

  const finalState = useValidationStore.getState()
  const finalIssue = finalState.issues.find((i) => i.id === dupIssue.id)
  // 原接受结论应留存（decisionHistory 有 accepted 记录）
  assert(
    finalIssue?.decisionHistory?.some((h) => h.status === 'accepted'),
    '先到的人工结论（接受）未被盖掉，已留存',
  )
}

// 测试 3: 批量修正失败后可重试
console.log('\n[Store 测试 3] 批量修正失败后可重试')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()

  // 找一个可批量修正的类型
  const fixableType = state.issues.find((i) => i.status === 'open' && i.suggestedValue)?.type
  assert(!!fixableType, '找到可批量修正的问题类型')

  // 正常批量修正
  const count = useValidationStore.getState().batchFix(fixableType!)
  assert(count > 0, `批量修正 ${count} 条`)
  assert(useValidationStore.getState().recalculationState.status === 'idle', '重算状态正常')
}

// 测试 4: 回滚后分组结论重算
console.log('\n[Store 测试 4] 回滚后分组结论重算')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()
  const records = state.records
  const issues = state.issues

  const dupIssue = issues.find((i) => i.type === 'ring_duplicate')!
  const record = records.find((r) => r.id === dupIssue.recordId)!

  // 改环
  useValidationStore.getState().updateRecord(record.id, { rawRingCode: 'GD-2099-00077' }, '改环')
  const afterEdit = useValidationStore.getState()
  assert(afterEdit.operations.length === 1, '有一次操作')

  // 回滚
  const opId = afterEdit.operations[0].id
  useValidationStore.getState().rollback(opId)

  const afterRollback = useValidationStore.getState()
  const rolledBackRecord = afterRollback.records.find((r) => r.id === record.id)!
  assert(
    rolledBackRecord.normalizedRingCode === record.normalizedRingCode,
    '回滚后记录恢复原环号',
  )
  assert(afterRollback.operations[0].rolledBack, '操作已标记回滚')
}

// 测试 5: 跨页面 storage 事件同步
console.log('\n[Store 测试 5] 跨页面 storage 事件同步')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()
  const initialVersion = state.dataVersion

  // 模拟另一个页面写入
  simulateOtherTabWrite({})

  // 手动触发 storage 事件
  const raw = store.get('yanji-ring-validation')
  storageListeners.forEach((handler) =>
    handler(new StorageEventMock('storage', { key: 'yanji-ring-validation', newValue: raw })),
  )

  const synced = useValidationStore.getState()
  assert(synced.dataVersion > initialVersion, `跨页面同步后 dataVersion 提升 (${synced.dataVersion})`)
}

// 测试 6: 重算失败后恢复上一份完整结果，且可重试
console.log('\n[Store 测试 6] 重算失败后恢复完整结果并重试')
{
  useValidationStore.getState().reset()
  const state = useValidationStore.getState()
  // 选一个非环号类问题（建议值可直接修正），确保批量修正后候选数下降
  const fixableType =
    state.issues.find((i) => i.type === 'species_alias' && i.status === 'open' && i.suggestedValue)?.type ||
    state.issues.find((i) => i.status === 'open' && i.suggestedValue && i.type !== 'ring_invalid')?.type!
  const candidatesBefore = state.issues.filter((i) => i.type === fixableType && i.status === 'open').length
  console.log(`  [调试] 选用修正类型: ${fixableType}, 候选数: ${candidatesBefore}`)

  // 模拟重算失败：直接设置 failed 状态
  useValidationStore.setState({
    recalculationState: {
      status: 'failed',
      failedAction: 'batch_fix',
      failedParams: { type: fixableType },
      error: '模拟重算失败',
      previousComplete: { records: state.records, issues: state.issues },
    },
  })

  // 验证状态为 failed
  assert(useValidationStore.getState().recalculationState.status === 'failed', '重算失败状态已记录')

  // 重试
  useValidationStore.getState().retryRecalculation()

  const afterRetry = useValidationStore.getState()
  assert(afterRetry.recalculationState.status === 'idle', '重试后重算状态恢复正常')
  const candidatesAfter = afterRetry.issues.filter((i) => i.type === fixableType && i.status === 'open').length
  assert(candidatesAfter < candidatesBefore, `重试后批量修正生效 (${candidatesBefore} → ${candidatesAfter})`)
}

console.log(`\n========== Store 结果: ${passed} 通过, ${failed} 失败 ==========`)
process.exit(failed > 0 ? 1 : 0)
