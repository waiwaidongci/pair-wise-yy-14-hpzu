import { DownloadOutlined, SearchOutlined } from '@ant-design/icons'
import { App as AntdApp, Button, Card, Input, Select, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { RecordTable } from '../components/RecordTable'
import { useValidationStore } from '../stores/validationStore'
import { exportRecordsCsv } from '../utils/exporters'

export function RecordsPage() {
  const { message } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const [keyword, setKeyword] = useState('')
  const [source, setSource] = useState('all')
  const [species, setSpecies] = useState('all')

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

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>合并记录总表</Typography.Title>
          <Typography.Paragraph type="secondary">
            统一查看归一化结果。表格启用虚拟滚动，可稳定浏览 {records.length.toLocaleString()} 条记录。
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
        <RecordTable records={filtered} height={590} />
      </Card>
    </div>
  )
}
