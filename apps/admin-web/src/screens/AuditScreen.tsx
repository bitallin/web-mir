import { Alert, Button, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type { AdminAuditEntry, AdminAuditResponse } from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { formatDateTime, ROLE_LABELS, shortId } from '../lib/format';

const ACTION_OPTIONS = [
  { value: 'player.kick', label: 'player.kick' },
  { value: 'player.ban', label: 'player.ban' },
  { value: 'player.mute', label: 'player.mute' },
  { value: 'content.draft.save', label: 'content.draft.save' },
  { value: 'content.publish', label: 'content.publish' },
  { value: 'content.activate', label: 'content.activate' },
];

export function AuditScreen() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState<string | undefined>();
  const [result, setResult] = useState<'success' | 'failed' | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(
        await adminApi.audit({
          ...(actor.length === 0 ? {} : { actor }),
          ...(action === undefined ? {} : { action }),
          ...(result === undefined ? {} : { result }),
          page,
          pageSize: 25,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取审计日志');
    } finally {
      setLoading(false);
    }
  }, [action, actor, page, result]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<AdminAuditEntry> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作者',
      dataIndex: 'actorUsername',
      width: 130,
      render: (value: string, row) => (
        <div className="player-cell">
          <strong>{value}</strong>
          <small className="muted-text">{ROLE_LABELS[row.actorRole]}</small>
        </div>
      ),
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 150,
      render: (value: string) => <code className="mono">{value}</code>,
    },
    {
      title: '对象',
      width: 170,
      render: (_value, row) => (
        <span>
          {row.targetType}
          {row.targetId === null ? '' : ` · ${shortId(row.targetId)}`}
        </span>
      ),
    },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '结果',
      width: 110,
      render: (_value, row) => (
        <Tag color={row.result === 'success' ? 'green' : 'red'}>
          {row.result === 'success' ? '成功' : (row.errorCode ?? '失败')}
        </Tag>
      ),
    },
    {
      title: 'requestId',
      dataIndex: 'requestId',
      width: 120,
      render: (value: string) => <code className="mono muted-text">{shortId(value)}</code>,
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="操作者账号"
            style={{ width: 180 }}
            onSearch={(value) => {
              setActor(value.trim());
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="动作"
            style={{ width: 180 }}
            value={action}
            onChange={(value: string | undefined) => {
              setAction(value);
              setPage(1);
            }}
            options={ACTION_OPTIONS}
          />
          <Select
            allowClear
            placeholder="结果"
            style={{ width: 120 }}
            value={result}
            onChange={(value: 'success' | 'failed' | undefined) => {
              setResult(value);
              setPage(1);
            }}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
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
          data-testid="audit-table"
        />
      </section>
    </div>
  );
}
