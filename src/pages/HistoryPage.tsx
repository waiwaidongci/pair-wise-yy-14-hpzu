import { ClockCircleOutlined, RollbackOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { App as AntdApp, Button, Card, Empty, List, Popconfirm, Space, Tag, Timeline, Typography } from 'antd'
import { useValidationStore } from '../stores/validationStore'

const actionLabels = {
  batch_fix: { label: '批量修正', color: 'cyan' },
  accept: { label: '接受', color: 'green' },
  return: { label: '退回', color: 'volcano' },
  manual_edit: { label: '人工编辑', color: 'blue' },
  reset: { label: '重置', color: 'default' },
}

export function HistoryPage() {
  const { message } = AntdApp.useApp()
  const operations = useValidationStore((state) => state.operations)
  const rollback = useValidationStore((state) => state.rollback)

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>操作历史与回滚</Typography.Title>
          <Typography.Paragraph type="secondary">
            每次批量修正、接受、退回或人工编辑都会保存完整快照，可恢复操作前的数据状态。
          </Typography.Paragraph>
        </div>
        <Tag icon={<SafetyCertificateOutlined />} color="green">审计记录仅保存在本机</Tag>
      </div>
      <Card className="table-card history-card" variant="borderless">
        {operations.length ? (
          <List
            itemLayout="horizontal"
            dataSource={operations}
            renderItem={(operation) => {
              const meta = actionLabels[operation.action]
              return (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="rollback"
                      title="回滚到该操作之前？"
                      description="该操作之后的所有修改也会被覆盖。"
                      okText="确认回滚"
                      cancelText="取消"
                      disabled={operation.rolledBack}
                      onConfirm={() => {
                        rollback(operation.id)
                        void message.success(`已回滚：${operation.title}`)
                      }}
                    >
                      <Button
                        type="link"
                        icon={<RollbackOutlined />}
                        disabled={operation.rolledBack}
                      >
                        {operation.rolledBack ? '已回滚' : '恢复此版本'}
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<ClockCircleOutlined className="history-icon" />}
                    title={
                      <Space>
                        <Tag color={meta.color}>{meta.label}</Tag>
                        <strong>{operation.title}</strong>
                        <span className="muted-text">{operation.count} 条</span>
                      </Space>
                    }
                    description={
                      <>
                        <span>{operation.detail}</span>
                        <div className="history-time">
                          {new Date(operation.timestamp).toLocaleString('zh-CN')}
                        </div>
                      </>
                    }
                  />
                </List.Item>
              )
            }}
          />
        ) : (
          <Empty description="还没有修改记录。在问题校验页执行处置后，这里会出现可回滚的操作。" />
        )}
      </Card>
      <Card className="audit-note" variant="borderless">
        <Timeline
          items={[
            { color: 'green', children: '操作前保存完整记录与问题状态快照' },
            { color: 'green', children: '所有批量处置均记录规则、时间与影响条数' },
            { color: 'green', children: '回滚后保留原操作痕迹，便于追溯' },
          ]}
        />
      </Card>
    </div>
  )
}
