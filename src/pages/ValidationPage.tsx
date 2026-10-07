import {
  CheckOutlined,
  DownloadOutlined,
  ExportOutlined,
  FilterOutlined,
  ReloadOutlined,
  RollbackOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import {
  App as AntdApp,
  Button,
  Card,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type MenuProps,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo, useState } from 'react'
import { ISSUE_RULES } from '../data/mockRecords'
import { filterIssues, useValidationStore } from '../stores/validationStore'
import type { IssueSeverity, IssueStatus, ValidationIssue } from '../types'
import { exportRecordsCsv, exportTransferJson, exportValidationCsv } from '../utils/exporters'
import { IssueDetailDrawer } from '../components/IssueDetailDrawer'
import { StatsCards } from '../components/StatsCards'

const severityMeta: Record<IssueSeverity, { label: string; color: string }> = {
  error: { label: '错误', color: 'red' },
  warning: { label: '警告', color: 'gold' },
  review: { label: '待确认', color: 'blue' },
}
const statusMeta: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: '待处理', color: 'processing' },
  accepted: { label: '已接受', color: 'green' },
  returned: { label: '已退回', color: 'volcano' },
  corrected: { label: '已修正', color: 'cyan' },
}

export function ValidationPage() {
  const { message, modal } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const operations = useValidationStore((state) => state.operations)
  const selectedIssueIds = useValidationStore((state) => state.selectedIssueIds)
  const setSelectedIssueIds = useValidationStore((state) => state.setSelectedIssueIds)
  const batchFix = useValidationStore((state) => state.batchFix)
  const acceptIssues = useValidationStore((state) => state.acceptIssues)
  const returnIssues = useValidationStore((state) => state.returnIssues)
  const updateRecord = useValidationStore((state) => state.updateRecord)
  const rollback = useValidationStore((state) => state.rollback)
  const reset = useValidationStore((state) => state.reset)
  const [severity, setSeverity] = useState<IssueSeverity | 'all'>('all')
  const [status, setStatus] = useState<IssueStatus | 'all'>('open')
  const [issueType, setIssueType] = useState<ValidationIssue['type'] | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  const filtered = useMemo(
    () => filterIssues(issues, { severity, status, type: issueType, keyword }),
    [issues, issueType, keyword, severity, status],
  )
  const activeIssue = issues.find((issue) => issue.id === activeIssueId) ?? null
  const activeRecord = records.find((record) => record.id === activeIssue?.recordId) ?? null

  const ruleItems: MenuProps['items'] = ISSUE_RULES.filter((rule) => rule.correctionMode === 'automatic').map((rule) => ({
    key: rule.type,
    label: `${rule.label}（${issues.filter((issue) => issue.type === rule.type && issue.status === 'open').length}）`,
  }))

  const runBatchFix = (type: string) => {
    const count = batchFix(type as ValidationIssue['type'])
    void message.success(count ? `已按规则修正 ${count} 条问题` : '当前没有可自动修正的问题')
  }

  const columns: ColumnsType<ValidationIssue> = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      fixed: 'left',
      filters: Object.entries(severityMeta).map(([value, meta]) => ({ text: meta.label, value })),
      onFilter: (value, record) => record.severity === value,
      render: (value: IssueSeverity) => (
        <Tag color={severityMeta[value].color}>{severityMeta[value].label}</Tag>
      ),
    },
    { title: '记录编号', dataIndex: 'recordId', width: 120, fixed: 'left' },
    { title: '问题', dataIndex: 'title', width: 190, ellipsis: true },
    {
      title: '说明',
      dataIndex: 'description',
      width: 360,
      ellipsis: true,
    },
    {
      title: '当前值',
      dataIndex: 'currentValue',
      width: 190,
      ellipsis: true,
      render: (value: string) => <Typography.Text code>{value || '空'}</Typography.Text>,
    },
    {
      title: '建议值',
      dataIndex: 'suggestedValue',
      width: 190,
      ellipsis: true,
      render: (value: string) =>
        value ? <span className="suggested-value">{value}</span> : <Typography.Text type="secondary">需人工判定</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: IssueStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => setActiveIssueId(record.id)}>
          核验处置
        </Button>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <StatsCards totalRecords={records.length} issues={issues} />
      <Card className="tool-card" variant="borderless">
        <div className="toolbar-row">
          <Space wrap>
            <Select
              value={severity}
              style={{ width: 128 }}
              onChange={setSeverity}
              options={[
                { value: 'all', label: '全部级别' },
                ...Object.entries(severityMeta).map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
            <Select
              value={status}
              style={{ width: 128 }}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label })),
              ]}
            />
            <Select
              value={issueType}
              style={{ width: 190 }}
              onChange={setIssueType}
              options={[
                { value: 'all', label: '全部问题类型' },
                ...ISSUE_RULES.map((rule) => ({ value: rule.type, label: rule.label })),
              ]}
            />
            <Input.Search
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索记录、问题或说明"
              style={{ width: 250 }}
            />
            <span className="filter-count"><FilterOutlined /> 当前 {filtered.length.toLocaleString()} 条</span>
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => {
              modal.confirm({
                title: '重新载入内置数据？',
                content: '当前处置和操作历史将被清空。',
                okText: '重新载入',
                onOk: reset,
              })
            }}>
              重新载入
            </Button>
          </Space>
        </div>
        <div className="toolbar-row toolbar-row--secondary">
          <Space wrap>
            <span className="toolbar-label">批量处置</span>
            <Dropdown menu={{ items: ruleItems, onClick: ({ key }) => runBatchFix(key) }} trigger={['click']}>
              <Button type="primary" icon={<ToolOutlined />}>按规则修正</Button>
            </Dropdown>
            <Button
              icon={<CheckOutlined />}
              disabled={!selectedIssueIds.length}
              onClick={() => acceptIssues(selectedIssueIds)}
            >
              接受所选
            </Button>
            <Button
              danger
              disabled={!selectedIssueIds.length}
              onClick={() => setReturnOpen(true)}
            >
              退回并说明
            </Button>
          </Space>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={() => exportValidationCsv(issues, records)}>
              导出问题 CSV
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'csv', label: '区域中心 CSV', icon: <DownloadOutlined /> },
                  { key: 'json', label: '区域中心 JSON', icon: <ExportOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'csv') exportRecordsCsv(records, issues)
                  else exportTransferJson(records, issues, operations)
                  void message.success('移交文件已生成')
                },
              }}
            >
              <Button type="primary">导出移交数据</Button>
            </Dropdown>
            <Button
              icon={<RollbackOutlined />}
              disabled={!operations.some((operation) => !operation.rolledBack)}
              onClick={() => {
                const target = operations.find((operation) => !operation.rolledBack)
                if (target) {
                  rollback(target.id)
                  void message.success(`已回滚：${target.title}`)
                }
              }}
            >
              回滚最近操作
            </Button>
          </Space>
        </div>
      </Card>
      <Card className="table-card" variant="borderless">
        <Table<ValidationIssue>
          virtual
          rowKey="id"
          size="small"
          bordered
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ x: 1400, y: 480 }}
          rowSelection={{
            selectedRowKeys: selectedIssueIds,
            onChange: (keys) => setSelectedIssueIds(keys.map(String)),
            preserveSelectedRowKeys: true,
          }}
          onRow={(record) => ({
            onDoubleClick: () => setActiveIssueId(record.id),
          })}
        />
      </Card>
      <IssueDetailDrawer
        issue={activeIssue}
        record={activeRecord}
        onClose={() => setActiveIssueId(null)}
        onAccept={() => {
          if (activeIssue) {
            acceptIssues([activeIssue.id])
            setActiveIssueId(null)
            void message.success('已接受原记录')
          }
        }}
        onReturn={(reason) => {
          if (activeIssue) {
            returnIssues([activeIssue.id], reason)
            setActiveIssueId(null)
            void message.success('已退回来源班组')
          }
        }}
        onSave={(value, reason) => {
          if (activeIssue && activeRecord) {
            updateRecord(activeRecord.id, { [activeIssue.field]: value }, reason)
            setActiveIssueId(null)
            void message.success('修正已保存，原值可回滚')
          }
        }}
      />
      <Modal
        title="填写退回来因"
        open={returnOpen}
        okText="确认退回"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !returnReason.trim() }}
        onCancel={() => setReturnOpen(false)}
        onOk={() => {
          returnIssues(selectedIssueIds, returnReason)
          setReturnOpen(false)
          setReturnReason('')
          void message.success('所选问题已退回')
        }}
      >
        <Input.TextArea
          rows={4}
          value={returnReason}
          onChange={(event) => setReturnReason(event.target.value)}
          placeholder="请说明需要来源班组补充或核对的材料"
        />
      </Modal>
    </div>
  )
}
