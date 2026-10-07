import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
} from '@ant-design/icons'
import { Card, Progress } from 'antd'
import type { ValidationIssue } from '../types'

interface StatsCardsProps {
  totalRecords: number
  issues: ValidationIssue[]
}

export function StatsCards({ totalRecords, issues }: StatsCardsProps) {
  // 待复核与待处理同属未完结 backlog：依据变化被退回的结论需要重新处置
  const pending = issues.filter((issue) => issue.status === 'open' || issue.status === 'recheck')
  const recheck = pending.filter((issue) => issue.status === 'recheck').length
  const resolved = issues.length - pending.length
  const completion = issues.length ? Math.round((resolved / issues.length) * 100) : 100
  const cards = [
    {
      label: '合并记录',
      value: totalRecords.toLocaleString(),
      hint: '来自 5 个野外数据源',
      icon: <FileSearchOutlined />,
      tone: 'teal',
    },
    {
      label: '错误',
      value: pending.filter((issue) => issue.severity === 'error').length,
      hint: '影响移交，需要处理',
      icon: <CloseCircleOutlined />,
      tone: 'red',
    },
    {
      label: '警告',
      value: pending.filter((issue) => issue.severity === 'warning').length,
      hint: '建议核实后处理',
      icon: <ExclamationCircleOutlined />,
      tone: 'amber',
    },
    {
      label: '待确认',
      value: pending.filter((issue) => issue.severity === 'review').length,
      hint: '需鉴定人员判断',
      icon: <CheckCircleOutlined />,
      tone: 'blue',
    },
  ]
  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <Card key={card.label} className={`stat-card stat-card--${card.tone}`} variant="borderless">
          <div className="stat-card__icon">{card.icon}</div>
          <div>
            <span className="stat-card__label">{card.label}</span>
            <strong className="stat-card__value">{card.value}</strong>
            <small>{card.hint}</small>
          </div>
        </Card>
      ))}
      <Card className="stat-card stat-card--progress" variant="borderless">
        <div className="stat-card__progress">
          <Progress type="circle" percent={completion} size={58} strokeColor="#168f73" />
          <div>
            <span className="stat-card__label">本轮处理进度</span>
            <strong className="stat-card__value">{resolved.toLocaleString()}</strong>
            <small>已接受、退回或修正{recheck ? `；${recheck} 条待复核` : ''}</small>
          </div>
        </div>
      </Card>
    </div>
  )
}
