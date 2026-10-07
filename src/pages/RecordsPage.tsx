import { DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { App as AntdApp, Button, Card, Input, Modal, Select, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { GroupDrawer } from '../components/GroupDrawer'
import { RecordTable } from '../components/RecordTable'
import { useValidationStore } from '../stores/validationStore'
import type { BirdRecord } from '../types'
import { exportRecordsCsv } from '../utils/exporters'

export function RecordsPage() {
  const { message } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const groups = useValidationStore((state) => state.groups)
  const updateRecord = useValidationStore((state) => state.updateRecord)
  const [keyword, setKeyword] = useState('')
  const [source, setSource] = useState('all')
  const [species, setSpecies] = useState('all')
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<BirdRecord | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editToken, setEditToken] = useState<number | undefined>(undefined)

  const sourceOptions = useMemo(
    () => [...new Set(records.map((record) => record.source))].map((value) => ({ value, label: value })),
    [records],
  )
  const speciesOptions = useMemo(
    () => [...new Set(records.map((record) => record.speciesCanonical))].map((value) => ({ value, label: value })),
    [records],
  )
  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return records.filter((record) => {
      if (source !== 'all' && record.source !== source) return false
      if (species !== 'all' && record.speciesCanonical !== species) return false
      if (
        text &&
        !record.id.toLowerCase().includes(text) &&
        !record.rawRingCode.toLowerCase().includes(text) &&
        !record.normalizedRingCode.toLowerCase().includes(text) &&
        !record.speciesRaw.toLowerCase().includes(text) &&
        !record.location.toLowerCase().includes(text)
      )
        return false
      return true
    })
  }, [keyword, records, source, species])

  const openRingEditor = (record: BirdRecord) => {
    // 捕获打开时的分组版本：保存时若分组已被问题校验页推进，则拒绝覆盖先到的人工结论
    setEditToken(record.groupKey ? groups[record.groupKey]?.revision : undefined)
    setEditValue(record.rawRingCode)
    setEditReason('')
    setEditing(record)
  }

  const submitRingEdit = () => {
    if (!editing || !editValue.trim()) return
    const result = updateRecord(
      editing.id,
      { rawRingCode: editValue.trim() },
      editReason.trim() || `合并记录页修正环号：${editing.rawRingCode} → ${editValue.trim()}`,
      editToken,
    )
    if (result.conflict) {
      void message.warning(result.message)
      setEditing(null)
      return
    }
    const parts = ['环号已更新，新旧两个分组已联动重算']
    if (result.rechecked) parts.push(`${result.rechecked} 条已处置结论退回待复核`)
    void message.success(parts.join('，'))
    setEditing(null)
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>合并记录总表</Typography.Title>
          <Typography.Paragraph type="secondary">
            统一查看归一化结果。表格启用虚拟滚动，可稳定浏览 {records.length.toLocaleString()} 条记录。点击归一化环号查看分组账。
          </Typography.Paragraph>
        </div>
        <Button icon={<DownloadOutlined />} onClick={() => {
          exportRecordsCsv(filtered, issues)
          void message.success(`已导出当前筛选结果 ${filtered.length.toLocaleString()} 条`)
        }}>
          导出当前结果
        </Button>
      </div>
      <Card className="tool-card" variant="borderless">
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索环号、鸟种、地点或记录编号"
            style={{ width: 320 }}
          />
          <Select value={source} onChange={setSource} options={[{ value: 'all', label: '全部来源' }, ...sourceOptions]} style={{ width: 210 }} />
          <Select value={species} onChange={setSpecies} options={[{ value: 'all', label: '全部鸟种' }, ...speciesOptions]} style={{ width: 180 }} />
          <span className="filter-count">显示 {filtered.length.toLocaleString()} / {records.length.toLocaleString()}</span>
        </Space>
      </Card>
      <Card className="table-card" variant="borderless">
        <RecordTable
          records={filtered}
          height={590}
          onShowGroup={(record) => setGroupKey(record.groupKey ?? null)}
          onEditRing={openRingEditor}
        />
      </Card>
      <GroupDrawer
        groupKey={groupKey}
        groups={groups}
        records={records}
        issues={issues}
        onClose={() => setGroupKey(null)}
      />
      <Modal
        title={`修正环号：${editing?.id ?? ''}`}
        open={Boolean(editing)}
        okText="保存并联动重算"
        cancelText="取消"
        okButtonProps={{ disabled: !editValue.trim() }}
        onCancel={() => setEditing(null)}
        onOk={submitRingEdit}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            保存后，原环号分组与新环号分组里的重复、跳变结论会一起失效并按新值重算；依据变了的已处置结论将退回待复核并保留原记录。
          </Typography.Paragraph>
          <Input
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            placeholder="输入核实后的环号，如 BJ-2024-01832"
          />
          <Input.TextArea
            rows={2}
            value={editReason}
            onChange={(event) => setEditReason(event.target.value)}
            placeholder="修正依据（可选），例如：已核对捕获登记表照片"
          />
        </Space>
      </Modal>
    </div>
  )
}
