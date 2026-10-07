import { ApartmentOutlined } from '@ant-design/icons'
import { Descriptions, Drawer, Empty, List, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { BirdRecord, IssueStatus, RingGroup, ValidationIssue } from '../types'

interface GroupDrawerProps {
  groupKey: string | null
  groups: Record<string, RingGroup>
  records: BirdRecord[]
  issues: ValidationIssue[]
  onClose: () => void
}

const statusMeta: Record<IssueStatus, { label: string; color: string }> = {
  open: { label: '待处理', color: 'processing' },
  accepted: { label: '已接受', color: 'green' },
  returned: { label: '已退回', color: 'volcano' },
  corrected: { label: '已修正', color: 'cyan' },
  recheck: { label: '待复核', color: 'purple' },
}

const provenanceLabels: Record<RingGroup['provenance'], string> = {
  backfill: '历史回填',
  recalc: '联动重算',
}

/** 联动账视图：一个环号分组的成员记录与挂账结论，同组同版本 */
export function GroupDrawer({ groupKey, groups, records, issues, onClose }: GroupDrawerProps) {
  const group = groupKey ? groups[groupKey] : undefined
  const members = groupKey ? records.filter((record) => record.groupKey === groupKey) : []
  const linkedIssues = groupKey ? issues.filter((issue) => issue.groupKey === groupKey) : []

  const memberColumns: ColumnsType<BirdRecord> = [
    { title: '记录编号', dataIndex: 'id', width: 118, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '观察时间', dataIndex: 'observedAt', width: 158 },
    { title: '来源', dataIndex: 'source', width: 150, ellipsis: true },
    { title: '地点', dataIndex: 'location', width: 130 },
    { title: '原始环号', dataIndex: 'rawRingCode', width: 150 },
  ]

  return (
    <Drawer
      width={720}
      open={Boolean(groupKey)}
      onClose={onClose}
      title={
        <Space>
          <ApartmentOutlined />
          <span>环号分组账</span>
          <Typography.Text code>{groupKey}</Typography.Text>
        </Space>
      }
    >
      {!group ? (
        <Empty description="该记录尚未进入环号分组账，可能缺少分组来源，需先回填" />
      ) : (
        <div className="page-stack">
          <Descriptions
            size="small"
            column={2}
            bordered
            items={[
              { key: 'revision', label: '账本版本', children: `v${group.revision}` },
              { key: 'provenance', label: '分组来源', children: provenanceLabels[group.provenance] },
              { key: 'members', label: '链上记录', children: `${members.length} 条` },
              {
                key: 'updatedAt',
                label: '最近结算',
                children: new Date(group.updatedAt).toLocaleString('zh-CN'),
              },
            ]}
          />
          <div>
            <Typography.Title level={5}>跨年回收链（{members.length}）</Typography.Title>
            <Table<BirdRecord>
              rowKey="id"
              size="small"
              bordered
              columns={memberColumns}
              dataSource={members}
              pagination={false}
              scroll={{ y: 260 }}
            />
          </div>
          <div>
            <Typography.Title level={5}>挂账结论（{linkedIssues.length}）</Typography.Title>
            {linkedIssues.length ? (
              <List
                size="small"
                dataSource={linkedIssues}
                renderItem={(issue) => (
                  <List.Item>
                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={statusMeta[issue.status].color}>{statusMeta[issue.status].label}</Tag>
                        <strong>{issue.title}</strong>
                        <Typography.Text code>{issue.recordId}</Typography.Text>
                        <span className="muted-text">依据版本 v{issue.groupRevision ?? 1}</span>
                        {issue.status === 'recheck' && issue.previousStatus && (
                          <Tag>原结论：{statusMeta[issue.previousStatus].label}</Tag>
                        )}
                      </Space>
                      <Typography.Text type="secondary">{issue.description}</Typography.Text>
                      {issue.invalidatedReason && (
                        <Typography.Text type="warning">失效原因:{issue.invalidatedReason}</Typography.Text>
                      )}
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="该分组当前没有挂账结论" />
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}
