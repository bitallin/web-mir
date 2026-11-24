import { Alert, Button, ConfigProvider, Tag, theme } from 'antd';

import { useControlApiHealth, type ServiceState } from './lib/health';

const NAV_ITEMS = [
  { label: '总览', phase: null },
  { label: '玩家', phase: '阶段 7' },
  { label: '世界与 Room', phase: '阶段 7' },
  { label: '游戏内容', phase: '阶段 7' },
  { label: '发布中心', phase: '阶段 7' },
  { label: '审计', phase: '阶段 7' },
];

const STATUS_LABEL: Record<ServiceState, string> = {
  checking: '检测中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
};

const STATUS_COLOR: Record<ServiceState, string> = {
  checking: 'default',
  online: 'success',
  degraded: 'warning',
  offline: 'error',
};

const DELIVERABLES = [
  {
    name: 'Monorepo 与工具链',
    status: '已建立',
    tone: 'success',
    note: 'pnpm workspace · TypeScript strict · ESLint · Vitest',
  },
  {
    name: 'PostgreSQL 基础设施',
    status: '已配置',
    tone: 'success',
    note: 'PostgreSQL 18.3 · Drizzle migrations · realms 基线表',
  },
  {
    name: 'Control API',
    status: '已实现',
    tone: 'success',
    note: 'Fastify 5 · 环境校验 · 结构化日志 · live/ready 健康检查',
  },
  {
    name: 'Colyseus Game Server',
    status: '运行时已建立',
    tone: 'processing',
    note: '阶段 1 接入世界地图 Room 与服务端权威移动',
  },
  {
    name: '运营后台',
    status: '未启用',
    tone: 'default',
    note: '玩家、Room、内容发布与审计功能在阶段 7 交付',
  },
];

export function App() {
  const { health, refresh } = useControlApiHealth();

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#c9a227',
          colorBgBase: '#0b0d10',
          colorTextBase: '#e8e0cd',
          colorBorder: '#232a32',
          borderRadius: 2,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <div className="console">
        <aside className="rail">
          <div className="rail-brand">
            <span>WEB LEGEND</span>
            <small>OPS</small>
          </div>

          <nav className="rail-nav" aria-label="后台模块">
            <p className="rail-section">工作台</p>
            <ul>
              {NAV_ITEMS.map((item, index) => (
                <li
                  key={item.label}
                  className={index === 0 ? 'rail-item rail-item-active' : 'rail-item'}
                  aria-current={index === 0 ? 'page' : undefined}
                >
                  <span>{item.label}</span>
                  {item.phase === null ? null : <em>{item.phase}</em>}
                </li>
              ))}
            </ul>
          </nav>

          <p className="rail-footer">阶段 0 · 工程底座</p>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div>
              <p className="kicker">运营控制台</p>
              <h1>工程状态</h1>
            </div>
            <div className="env-badge">LOCAL</div>
          </header>

          <section className="status-row" aria-label="服务状态">
            <article className="panel">
              <p className="panel-label">Control API</p>
              <div className="panel-value">
                <Tag color={STATUS_COLOR[health.state]}>{STATUS_LABEL[health.state]}</Tag>
              </div>
              <p className="panel-note">{health.detail}</p>
              <Button size="small" onClick={refresh}>
                重新检测
              </Button>
            </article>

            <article className="panel">
              <p className="panel-label">数据库</p>
              <div className="panel-value">
                <Tag color={health.state === 'online' ? 'success' : 'default'}>
                  {health.state === 'online' ? '就绪' : '未确认'}
                </Tag>
              </div>
              <p className="panel-note">通过 Control API readiness 探针检查</p>
            </article>

            <article className="panel">
              <p className="panel-label">在线玩家</p>
              <div className="panel-value panel-value-muted">—</div>
              <p className="panel-note">阶段 7 接入实时世界数据后显示</p>
            </article>
          </section>

          <section className="panel panel-wide" aria-labelledby="deliverables-title">
            <div className="panel-heading">
              <h2 id="deliverables-title">阶段 0 交付检查</h2>
              <span>最后更新 · 本次会话</span>
            </div>

            <ul className="deliverables">
              {DELIVERABLES.map((item) => (
                <li key={item.name}>
                  <div className="deliverable-main">
                    <strong>{item.name}</strong>
                    <Tag color={item.tone}>{item.status}</Tag>
                  </div>
                  <p>{item.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <Alert
            type="info"
            showIcon
            message="后台数据通过 Control API 访问"
            description="本页不直接连接数据库，也不虚构玩家或经济数据。玩家查询、Kick/Ban/Mute、内容发布与审计将在阶段 7 实现。"
          />
        </main>
      </div>
    </ConfigProvider>
  );
}
