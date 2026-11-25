import { App as AntApp, Button, ConfigProvider, Spin, Tag, theme } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AdminPermission, AdminView } from '@web-legend/contracts';

import { adminApi } from './api/adminClient';
import { AuditScreen } from './screens/AuditScreen';
import { CommandsScreen } from './screens/CommandsScreen';
import { ContentScreen } from './screens/ContentScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PlayersScreen } from './screens/PlayersScreen';
import { ReleasesScreen } from './screens/ReleasesScreen';
import { RoomsScreen } from './screens/RoomsScreen';
import { ROLE_LABELS } from './lib/format';

type SectionId = 'overview' | 'players' | 'rooms' | 'content' | 'releases' | 'audit' | 'commands';

type NavItem = {
  id: SectionId;
  label: string;
  hint: string;
  permission: AdminPermission;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: '运行总览', hint: '异常优先', permission: 'dashboard.read' },
  { id: 'players', label: '玩家与账号', hint: '查询与处置', permission: 'players.read' },
  { id: 'rooms', label: '世界与 Room', hint: '实例与 tick', permission: 'rooms.read' },
  { id: 'content', label: '内容工作台', hint: '草稿与校验', permission: 'content.read' },
  { id: 'releases', label: '发布中心', hint: '激活与回滚', permission: 'content.read' },
  { id: 'audit', label: '审计日志', hint: '不可变记录', permission: 'audit.read' },
  { id: 'commands', label: '运营指令', hint: 'Outbox 投递', permission: 'commands.read' },
];

const SECTION_TITLES: Record<SectionId, { kicker: string; title: string }> = {
  overview: { kicker: 'Overview', title: '运行总览' },
  players: { kicker: 'Players', title: '玩家与账号' },
  rooms: { kicker: 'World', title: '世界与 Room' },
  content: { kicker: 'Game Content', title: '内容工作台' },
  releases: { kicker: 'Release Center', title: '发布中心' },
  audit: { kicker: 'Audit', title: '审计日志' },
  commands: { kicker: 'Operations', title: '运营指令' },
};

const CONSOLE_THEME = {
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
  components: {
    Table: {
      headerBg: '#0f1318',
      rowHoverBg: 'rgba(201, 162, 39, 0.08)',
      borderColor: '#1b2229',
    },
  },
};

export function App() {
  const [admin, setAdmin] = useState<AdminView | null | undefined>(undefined);
  const [section, setSection] = useState<SectionId>('overview');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then((result) => {
        if (!cancelled) {
          setAdmin(result.admin);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdmin(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await adminApi.logout();
    setAdmin(null);
  }, []);

  const visibleItems = useMemo(
    () =>
      admin === null || admin === undefined
        ? []
        : NAV_ITEMS.filter((item) => admin.permissions.includes(item.permission)),
    [admin],
  );

  useEffect(() => {
    if (admin === null || admin === undefined || visibleItems.length === 0) {
      return;
    }
    if (!visibleItems.some((item) => item.id === section)) {
      const first = visibleItems[0];
      if (first !== undefined) {
        setSection(first.id);
      }
    }
  }, [admin, section, visibleItems]);

  return (
    <ConfigProvider theme={CONSOLE_THEME}>
      <AntApp>
        {admin === undefined ? (
          <div className="splash">
            <Spin />
            <span>正在验证管理员会话…</span>
          </div>
        ) : admin === null ? (
          <LoginScreen onLogin={setAdmin} />
        ) : (
          <div className="console">
            <aside className="rail">
              <div className="rail-brand">
                <span>WEB LEGEND</span>
                <small>OPS</small>
              </div>

              <nav className="rail-nav" aria-label="后台模块">
                <p className="rail-section">工作台</p>
                <ul>
                  {visibleItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === section ? 'rail-item rail-item-active' : 'rail-item'}
                        aria-current={item.id === section ? 'page' : undefined}
                        onClick={() => setSection(item.id)}
                        data-testid={`nav-${item.id}`}
                      >
                        <span>{item.label}</span>
                        <em>{item.hint}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="rail-footer">
                <span>{ROLE_LABELS[admin.role]}</span>
                <strong>{admin.username}</strong>
                <button type="button" className="rail-logout" onClick={() => void logout()}>
                  退出登录
                </button>
              </div>
            </aside>

            <main className="workspace">
              <header className="topbar">
                <div>
                  <p className="kicker">{SECTION_TITLES[section].kicker}</p>
                  <h1>{SECTION_TITLES[section].title}</h1>
                </div>
                <div className="topbar-meta">
                  <Tag color="gold">LOCAL</Tag>
                  <span className="muted-text">
                    {ROLE_LABELS[admin.role]} · {admin.username}
                  </span>
                  <Button size="small" onClick={() => void logout()}>
                    退出
                  </Button>
                </div>
              </header>

              {section === 'overview' ? <OverviewScreen /> : null}
              {section === 'players' ? <PlayersScreen admin={admin} /> : null}
              {section === 'rooms' ? <RoomsScreen /> : null}
              {section === 'content' ? <ContentScreen admin={admin} /> : null}
              {section === 'releases' ? <ReleasesScreen admin={admin} /> : null}
              {section === 'audit' ? <AuditScreen /> : null}
              {section === 'commands' ? <CommandsScreen /> : null}
            </main>
          </div>
        )}
      </AntApp>
    </ConfigProvider>
  );
}
