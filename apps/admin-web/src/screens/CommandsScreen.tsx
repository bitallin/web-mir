import { Alert, Button, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type {
  AdminCommandStatus,
  AdminCommandType,
  AdminCommandView,
  AdminCommandsResponse,
} from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { COMMAND_STATUS_TONE, formatDateTime, shortId } from '../lib/format';

const REFRESH_MS = 10_000;

export function CommandsScreen() {
  const [status, setStatus] = useState<AdminCommandStatus | undefined>();
  const [type, setType] = useState<AdminCommandType | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminCommandsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(
        await adminApi.commands({
          ...(status === undefined ? {} : { status }),
          ...(type === undefined ? {} : { type }),
          page,
          pageSize: 25,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取运营指令');
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const columns: ColumnsType<AdminCommandView> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: AdminCommandStatus) => <Tag color={COMMAND_STATUS_TONE[value]}>{value}</Tag>,
    },
    { title: '类型', dataIndex: 'type', width: 80 },
    {
      title: '目标',
      width: 170,
      render: (_value, row) => (
        <div className="player-cell">
          <strong>{row.targetName}</strong>
          <small className="mono muted-text">{shortId(row.targetId)}</small>
        </div>
      ),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 240,
      ellipsis: true,
    },
    { title: '操作者', dataIndex: 'actorUsername', width: 110 },
    { title: '尝试', dataIndex: 'attempts', width: 60 },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <Space wrap>
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={status}
            onChange={(value: AdminCommandStatus | undefined) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'pending', label: '待投递' },
              { value: 'dispatched', label: '已投递' },
              { value: 'applied', label: '已执行' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <Select
            allowClear
            placeholder="类型"
            style={{ width: 120 }}
            value={type}
            onChange={(value: AdminCommandType | undefined) => {
              setType(value);
              setPage(1);
            }}
            options={[
              { value: 'kick', label: '踢下线' },
              { value: 'ban', label: '封禁' },
              { value: 'mute', label: '禁言' },
            ]}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      {error !== null ? <Alert type="error" showIcon message={error} /> : null}

      <section className="panel">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 25,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          data-testid="commands-table"
        />
      </section>
    </div>
  );
}
