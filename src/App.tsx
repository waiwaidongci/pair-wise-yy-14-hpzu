import {
  AuditOutlined,
  CheckSquareOutlined,
  DatabaseOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import { Layout, Tag } from 'antd'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/validation', label: '问题校验', icon: <CheckSquareOutlined /> },
  { path: '/records', label: '合并记录', icon: <DatabaseOutlined /> },
  { path: '/history', label: '操作历史', icon: <HistoryOutlined /> },
  { path: '/rules', label: '规则词典', icon: <AuditOutlined /> },
]

export function App() {
  const location = useLocation()
  const current = NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))
  return (
    <Layout className="app-shell">
      <Layout.Sider width={226} className="app-sider">
        <div className="brand">
          <div className="brand__mark">雁</div>
          <div>
            <strong>雁迹</strong>
            <span>Ring Data Transfer</span>
          </div>
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="transfer-card">
          <span className="transfer-card__status" />
          <div>
            <strong>2026 春季移交批次</strong>
            <span>华东区域环志中心</span>
          </div>
        </div>
        <div className="sider-footer">
          <span>标准 CN-RING-2026.1</span>
          <Tag color="green">本地运行</Tag>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="app-header">
          <div>
            <span className="eyebrow">野生鸟类保护数据治理</span>
            <strong>{current?.label ?? '问题校验'}</strong>
          </div>
          <div className="header-meta">
            <span className="header-meta__dot" />
            <span>5 个来源已合并</span>
            <span className="header-meta__divider" />
            <span>数据版本 2026-10-06</span>
          </div>
        </Layout.Header>
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
