import { Alert, Button, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type { AdminDashboard, AdminRoom } from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { formatDateTime, shortId } from '../lib/format';

const REFRESH_MS = 10_000;

function MetricTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'danger' | 'warn' | undefined;
}) {
  return (
    <article className={`metric-tile${tone === undefined ? '' : ` metric-tile-${tone}`}`}>
      <p className="metric-label">{label}</p>
      <strong className="metric-value">{value}</strong>
      <p className="metric-note">{note}</p>
    </article>
  );
}

export function OverviewScreen() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      setDashboard(await adminApi.dashboard());
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取总览数据');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const roomColumns: ColumnsType<AdminRoom> = [
    {
      title: 'Room',
      dataIndex: 'roomId',
      render: (roomId: string) => <code className="mono">{shortId(roomId)}</code>,
    },
    {
      title: '地图',
      dataIndex: 'mapId',
      render: (mapId: string) => <span className="map-label">{mapId}</span>,
    },
    { title: '实例', dataIndex: 'instanceId', width: 70 },
    {
      title: '人数',
      dataIndex: 'players',
      width: 80,
      sorter: (left, right) => left.players - right.players,
    },
    {
      title: 'tick p95',
      dataIndex: 'tickP95Ms',
      width: 100,
      render: (value: number) => `${value.toFixed(2)} ms`,
    },
    {
      title: '内容版本',
      dataIndex: 'contentVersion',
      render: (version: string) => <Tag color="gold">{version}</Tag>,
    },
  ];

  if (loading) {
    return (
      <div className="screen-loading">
        <Spin />
        <span>读取运行状态…</span>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <div className="section-actions">
          <span className="muted-text">更新于 {formatDateTime(dashboard?.generatedAt)}</span>
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      {error !== null ? <Alert type="error" showIcon message={error} /> : null}

      {dashboard !== null && dashboard.alerts.length > 0 ? (
        <div className="alert-stack" data-testid="overview-alerts">
          {dashboard.alerts.map((alert) => (
            <Alert key={alert.message} type={alert.level} showIcon message={alert.message} />
          ))}
        </div>
      ) : null}

      {dashboard !== null ? (
        <>
          <section className="metric-grid">
            <MetricTile
              label="在线玩家"
              value={String(dashboard.metrics.onlinePlayers)}
              note={`${String(dashboard.metrics.rooms)} 个运行房间`}
            />
            <MetricTile
              label="账号 / 角色"
              value={`${String(dashboard.metrics.accounts)} / ${String(dashboard.metrics.characters)}`}
              note="PostgreSQL 持久化总数"
            />
            <MetricTile
              label="待投递指令"
              value={String(dashboard.metrics.pendingCommands)}
              note={
                dashboard.metrics.oldestPendingAgeMs === null
                  ? '没有排队中的运营指令'
                  : `最老等待 ${String(Math.round(dashboard.metrics.oldestPendingAgeMs / 1_000))} 秒`
              }
              tone={dashboard.metrics.pendingCommands > 0 ? 'warn' : undefined}
            />
            <MetricTile
              label="失败指令"
              value={String(dashboard.metrics.failedCommands)}
              note="需要运营复核"
              tone={dashboard.metrics.failedCommands > 0 ? 'danger' : undefined}
            />
            <MetricTile
              label="激活内容版本"
              value={dashboard.metrics.activeContentVersion ?? '基线'}
              note={
                dashboard.health.gameServer === 'offline'
                  ? 'Game Server 离线'
                  : '新 Room 使用该版本'
              }
              tone={dashboard.metrics.activeContentVersion === null ? 'warn' : undefined}
            />
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h3>运行中的地图实例</h3>
              <span className="mono">
                {dashboard.health.database === 'ok' ? 'DB OK' : 'DB ERROR'} ·{' '}
                {dashboard.health.gameServer === 'ok' ? 'GS OK' : 'GS OFFLINE'}
              </span>
            </div>
            <Table
              size="small"
              rowKey="roomId"
              columns={roomColumns}
              dataSource={dashboard.rooms}
              pagination={false}
              locale={{ emptyText: '当前没有运行中的地图实例' }}
              data-testid="overview-rooms"
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
