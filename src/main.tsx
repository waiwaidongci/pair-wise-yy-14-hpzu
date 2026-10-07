import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#168f73',
          colorInfo: '#2477d4',
          colorSuccess: '#168f73',
          colorWarning: '#d8941e',
          colorError: '#cf3f45',
          borderRadius: 7,
          fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        },
        components: {
          Table: { headerBg: '#f3f7f5', headerColor: '#28443c' },
          Card: { boxShadowTertiary: '0 8px 24px rgba(24, 65, 53, .06)' },
        },
      }}
    >
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
