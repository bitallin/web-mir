import { Alert, Button, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type { AdminRoom, AdminRoomsResponse } from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { formatDateTime, shortId } from '../lib/format';

const REFRESH_MS = 8_000;

export function RoomsScreen() {
  const [rooms, setRooms] = useState<AdminRoomsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRooms(await adminApi.rooms());
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取世界状态');
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

  const columns: ColumnsType<AdminRoom> = [
    {
      title: 'Room ID',
      dataIndex: 'roomId',
      render: (value: string) => <code className="mono">{shortId(value)}</code>,
    },
    {
      title: '地图',
      dataIndex: 'mapId',
      render: (value: string) => <span className="map-label">{value}</span>,
    },
    { title: '实例', dataIndex: 'instanceId', width: 70 },
    {
      title: '人数',
      dataIndex: 'players',
      width: 80,
      sorter: (left, right) => left.players - right.players,
    },
    {
      title: 'tick p50 / p95 / p99',
      width: 180,
      render: (_value, row) =>
        `${row.tickP50Ms.toFixed(2)} / ${row.tickP95Ms.toFixed(2)} / ${row.tickP99Ms.toFixed(2)} ms`,
    },
    {
      title: '内容版本',
      dataIndex: 'contentVersion',
      render: (value: string) => <Tag color="gold">{value}</Tag>,
    },
    {
      title: '内容 checksum',
      dataIndex: 'contentChecksum',
      render: (value: string) => (
        <code className="mono muted-text" title={value}>
          {value.slice(0, 12)}…
        </code>
      ),
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <div className="section-actions">
          {rooms?.gameServer !== null && rooms?.gameServer !== undefined ? (
            <span className="muted-text">
              {rooms.gameServer.serverId} · 运行 {formatDateTime(rooms.gameServer.timestamp)}
            </span>
          ) : null}
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      {error !== null ? <Alert type="error" showIcon message={error} /> : null}
      {rooms?.status === 'offline' ? (
        <Alert
          type="error"
          showIcon
          message="Game Server 离线"
          description={rooms.detail ?? '无法读取内部状态端点；运营指令会保留在 Outbox。'}
        />
      ) : null}

      <section className="panel">
        <Table
          size="small"
          rowKey="roomId"
          loading={loading}
          columns={columns}
          dataSource={rooms?.gameServer?.rooms ?? []}
          pagination={false}
          locale={{ emptyText: '当前没有运行中的地图实例' }}
          data-testid="rooms-table"
        />
      </section>

      {rooms?.gameServer !== null && rooms?.gameServer !== undefined ? (
        <section className="panel panel-slim">
          <div className="kv-row">
            <span>服务进程</span>
            <strong>{rooms.gameServer.serverId}</strong>
            <span>运行时长</span>
            <strong>{Math.round(rooms.gameServer.uptimeSeconds / 60)} 分钟</strong>
            <span>已处理指令</span>
            <strong>{rooms.gameServer.totals.activeCommands}</strong>
          </div>
        </section>
      ) : null}
    </div>
  );
}
