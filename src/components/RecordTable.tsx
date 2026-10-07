import { Button, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { BirdRecord } from '../types'

interface RecordTableProps {
  records: BirdRecord[]
  selectedRowKeys?: React.Key[]
  onSelectionChange?: (keys: React.Key[]) => void
  onShowGroup?: (record: BirdRecord) => void
  onEditRing?: (record: BirdRecord) => void
  height?: number
  compact?: boolean
}

export function RecordTable({
  records,
  selectedRowKeys,
  onSelectionChange,
  onShowGroup,
  onEditRing,
  height = 560,
  compact = false,
}: RecordTableProps) {
  const columns: ColumnsType<BirdRecord> = [
    {
      title: '记录编号',
      dataIndex: 'id',
      width: 120,
      fixed: 'left',
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 190,
      ellipsis: true,
      render: (value: string, record) => (
        <Tooltip title={record.sourceFile}>
          <span>{value}</span>
        </Tooltip>
      ),
    },
    {
      title: '原始环号',
      dataIndex: 'rawRingCode',
      width: 145,
      render: (value: string, record) =>
        value === record.normalizedRingCode ? (
          value
        ) : (
          <Tag color="orange">{value}</Tag>
        ),
    },
    {
      title: '归一化环号',
      dataIndex: 'normalizedRingCode',
      width: 150,
      render: (value: string, record) =>
        onShowGroup && record.groupKey ? (
          <Button
            type="link"
            size="small"
            className="ring-link"
            onClick={() => onShowGroup(record)}
          >
            {value || '未识别'}
          </Button>
        ) : (
          <strong className="ring-code">{value || '未识别'}</strong>
        ),
    },
    {
      title: '环志方案',
      dataIndex: 'ringScheme',
      width: 150,
      ellipsis: true,
    },
    {
      title: '原始鸟种',
      dataIndex: 'speciesRaw',
      width: 152,
      ellipsis: true,
      render: (value: string, record) =>
        value === record.speciesCanonical ? value : <Tag color="gold">{value}</Tag>,
    },
    {
      title: '规范鸟种 / 学名',
      dataIndex: 'speciesCanonical',
      width: 210,
      render: (value: string, record) => (
        <span>
          <strong>{value}</strong>
          <em className="scientific-name">{record.scientificName}</em>
        </span>
      ),
    },
    { title: '观察时间', dataIndex: 'observedAt', width: 160 },
    { title: '地点', dataIndex: 'location', width: 140 },
    {
      title: '坐标',
      key: 'coordinate',
      width: 180,
      render: (_, record) =>
        record.latitude === null || record.longitude === null ? (
          <Tag color="red">格式异常</Tag>
        ) : (
          <span className="coordinate-cell">
            {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
          </span>
        ),
    },
    { title: '环志员', dataIndex: 'recorder', width: 100 },
    ...(compact
      ? []
      : [
          { title: '年龄', dataIndex: 'ageCode', width: 90 },
          { title: '性别', dataIndex: 'sex', width: 70 },
          { title: '备注', dataIndex: 'remarks', width: 260, ellipsis: true },
        ]),
    ...(onEditRing
      ? [
          {
            title: '操作',
            key: 'actions',
            fixed: 'right' as const,
            width: 96,
            render: (_: unknown, record: BirdRecord) => (
              <Button type="link" size="small" onClick={() => onEditRing(record)}>
                改环号
              </Button>
            ),
          },
        ]
      : []),
  ]

  return (
    <Table<BirdRecord>
      virtual
      size="small"
      bordered
      rowKey="id"
      columns={columns}
      dataSource={records}
      pagination={false}
      scroll={{ x: 1850, y: height }}
      rowSelection={
        onSelectionChange
          ? {
              selectedRowKeys,
              onChange: onSelectionChange,
              preserveSelectedRowKeys: true,
            }
          : undefined
      }
    />
  )
}
