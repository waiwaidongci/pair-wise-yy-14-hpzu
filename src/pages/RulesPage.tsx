import {
  ApartmentOutlined,
  EnvironmentOutlined,
  FontColorsOutlined,
  NumberOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Card, Collapse, Descriptions, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ISSUE_RULES } from '../data/mockRecords'
import { RING_SCHEMES, SPECIES_RULES } from '../utils/normalization'
import type { IssueRule } from '../types'

export function RulesPage() {
  const issueColumns: ColumnsType<IssueRule> = [
    {
      title: '校验项',
      dataIndex: 'label',
      width: 210,
      render: (value, record) => <strong>{value}<span className="muted-text"> · {record.type}</span></strong>,
    },
    {
      title: '级别',
      dataIndex: 'severity',
      width: 100,
      render: (value) => (
        <Tag color={value === 'error' ? 'red' : value === 'warning' ? 'gold' : 'blue'}>
          {value === 'error' ? '错误' : value === 'warning' ? '警告' : '待确认'}
        </Tag>
      ),
    },
    { title: '处理方式', dataIndex: 'correctionMode', width: 130, render: (value) => value === 'automatic' ? '可批量修正' : '人工核验' },
    { title: '规则说明', dataIndex: 'description' },
  ]

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>归一化与校验规则</Typography.Title>
          <Typography.Paragraph type="secondary">
            规则在浏览器内运行，移交时会把规则版本、原始值与归一化值一并写入审计信息。
          </Typography.Paragraph>
        </div>
        <Tag icon={<SafetyCertificateOutlined />} color="green">规则集 CN-RING-2026.1</Tag>
      </div>

      <div className="rules-grid">
        <Card variant="borderless" className="rule-summary-card">
          <NumberOutlined className="rule-icon" />
          <div>
            <strong>环号方案</strong>
            <span>{RING_SCHEMES.length} 个已登记前缀</span>
          </div>
        </Card>
        <Card variant="borderless" className="rule-summary-card">
          <FontColorsOutlined className="rule-icon" />
          <div>
            <strong>鸟种词典</strong>
            <span>{SPECIES_RULES.length} 个规范物种</span>
          </div>
        </Card>
        <Card variant="borderless" className="rule-summary-card">
          <EnvironmentOutlined className="rule-icon" />
          <div>
            <strong>坐标阈值</strong>
            <span>45 天 / 500 公里</span>
          </div>
        </Card>
        <Card variant="borderless" className="rule-summary-card">
          <ApartmentOutlined className="rule-icon" />
          <div>
            <strong>跨来源日期差</strong>
            <span>按环号完整匹配</span>
          </div>
        </Card>
      </div>

      <Card className="table-card" title="问题判定规则" variant="borderless">
        <Table rowKey="type" columns={issueColumns} dataSource={ISSUE_RULES} pagination={false} size="small" />
      </Card>

      <Card variant="borderless" title="方案与鸟种词典样例" className="rule-dictionary-card">
        <Collapse
          items={[
            {
              key: 'rings',
              label: `环号前缀映射（${RING_SCHEMES.length}）`,
              children: (
                <div className="scheme-list">
                  {RING_SCHEMES.map((scheme) => (
                    <Descriptions
                      key={scheme.prefix}
                      size="small"
                      column={1}
                      bordered
                      items={[
                        { key: 'raw', label: '来源前缀', children: scheme.prefix },
                        { key: 'normalized', label: '归一化前缀', children: scheme.normalizedPrefix },
                        { key: 'org', label: '管理机构', children: scheme.organization },
                        { key: 'pattern', label: '标准格式', children: scheme.pattern },
                      ]}
                    />
                  ))}
                </div>
              ),
            },
            {
              key: 'species',
              label: `鸟种同义名映射（${SPECIES_RULES.length}）`,
              children: (
                <div className="species-rule-list">
                  {SPECIES_RULES.map((rule) => (
                    <div className="species-rule" key={rule.canonical}>
                      <strong>{rule.canonical}</strong>
                      <em>{rule.scientificName}</em>
                      <div>
                        {rule.aliases.map((alias) => <Tag key={alias}>{alias}</Tag>)}
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
