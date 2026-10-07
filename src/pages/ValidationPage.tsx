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
  Alert,
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
  recheck: { label: '待复核', color: 'purple' },
}

export function ValidationPage() {
  const { message, modal } = AntdApp.useApp()
  const records = useValidationStore((state) => state.records)
  const issues = useValidationStore((state) => state.issues)
  const groups = useValidationStore((state) => state.groups)
  const recalcJob = useValidationStore((state) => state.recalcJob)
  const operations = useValidationStore((state) => state.operations)
  const selectedIssueIds = useValidationStore((state) => state.selectedIssueIds)
  const setSelectedIssueIds = useValidationStore((state) => state.setSelectedIssueIds)
  const batchFix = useValidationStore((state) => state.batchFix)
  const acceptIssues = useValidationStore((state) => state.acceptIssues)
  const returnIssues = useValidationStore((state) => state.returnIssues)
  const updateRecord = useValidationStore((state) => state.updateRecord)
  const retryRecalc = useValidationStore((state) => state.retryRecalc)
  const rollback = useValidationStore((state) => state.rollback)
  const reset = useValidationStore((state) => state.reset)
  const [severity, setSeverity] = useState<IssueSeverity | 'all'>('all')
  const [status, setStatus] = useState<IssueStatus | 'all'>('open')
  const [issueType, setIssueType] = useState<ValidationIssue['type'] | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null)
  const [editToken, setEditToken] = useState<number | undefined>(undefined)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  const filtered = useMemo(
    () => filterIssues(issues, { severity, status, type: issueType, keyword }),
    [issues, issueType, keyword, severity, status],
  )
  const activeIssue = issues.find((issue) => issue.id === activeIssueId) ?? null
  const activeRecord = records.find((record) => record.id === activeIssue?.recordId) ?? null

  const openIssue = (issueId: string) => {
    const issue = issues.find((item) => item.id === issueId)
    // 记录打开时的分组版本作为乐观锁令牌，保存时校验分组是否被其他页面推进
    setEditToken(issue?.groupKey ? groups[issue.groupKey]?.revision : undefined)
    setActiveIssueId(issueId)
  }

  const ruleItems: MenuProps['items'] = ISSUE_RULES.filter((rule) => rule.correctionMode === 'automatic').map((rule) => ({
    key: rule.type,
    label: `${rule.label}（${issues.filter((issue) => issue.type === rule.type && issue.status === 'open').length}）`,
  }))

  const runBatchFix = (type: string) => {
    const result = batchFix(type as ValidationIssue['type'])
    if (!result.ok) {
      void message.warning(result.message ?? '批量修正未执行')
      return
    }
    if (!result.applied) {
      void message.info('当前没有可自动修正的问题')
      return
    }
    const parts = [`已按规则修正 ${result.applied} 条问题`]
    if (result.invalidated) parts.push(`${result.invalidated} 条同组旧结论失效重算`)
    if (result.rechecked) parts.push(`${result.rechecked} 条已处置结论退回待复核`)
    if (result.skipped) parts.push(`${result.skipped} 条因分组被其他页面更新而跳过`)
    void message.success(parts.join('，'))
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
      render: (value: IssueStatus, record) => (
        <Tag color={statusMeta[value].color} title={record.invalidatedReason}>
          {statusMeta[value].label}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 120,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => openIssue(record.id)}>
          核验处置
        </Button>
      ),
    },
  ]

  return (
    <div className="page-stack">
      <StatsCards totalRecords={records.length} issues={issues} />
      {recalcJob?.status === 'failed' && (
        <Alert
          showIcon
          type="error"
          message="联动重算中断"
          description={`「${recalcJob.cause}」在分组 ${recalcJob.done.length}/${recalcJob.queue.length} 处中断：${recalcJob.error ?? '未知错误'}。已完成的分组结果已保留，可重试续算。`}
          action={
            <Button
              size="small"
              danger
              onClick={() => {
                retryRecalc()
                void message.info('已从上一份完整结果继续重算')
              }}
            >
              重试续算
            </Button>
          }
        />
      )}
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
                  else exportTransferJson(records, issues, operations, groups)
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
            onDoubleClick: () => openIssue(record.id),
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
            const result = updateRecord(activeRecord.id, { [activeIssue.field]: value }, reason, editToken)
            if (result.conflict) {
              void message.warning(result.message)
              return
            }
            setActiveIssueId(null)
            const parts = ['修正已保存，原值可回滚']
            if (result.invalidated) parts.push(`同组 ${result.invalidated} 条旧结论已失效重算`)
            if (result.rechecked) parts.push(`${result.rechecked} 条已处置结论退回待复核`)
            void message.success(parts.join('，'))
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
