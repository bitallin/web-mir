import { Alert, App as AntApp, Button, Input, Modal, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type {
  AdminContentActivation,
  AdminContentReleasesResponse,
  AdminContentState,
  AdminReleaseSummary,
  AdminView,
} from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { formatDateTime, shortId } from '../lib/format';

function ActivateModal({
  target,
  onClose,
  onDone,
}: {
  target: AdminReleaseSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (target === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.activateContent(target.id, reason.trim());
      message.success(`已激活 ${target.version}`);
      setReason('');
      onDone();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '激活失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={target !== null}
      title="激活内容版本"
      okText="确认激活"
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ disabled: reason.trim().length < 2 }}
      onOk={() => void submit()}
      onCancel={() => {
        setReason('');
        setError(null);
        onClose();
      }}
      destroyOnHidden
    >
      {target !== null ? (
        <div className="action-modal">
          <p className="action-target">
            目标版本：<strong>{target.version}</strong> · {target.checksum.slice(0, 12)}…
          </p>
          <Alert
            type="warning"
            showIcon
            message="激活只影响之后创建的新 Room；已有 Room 保持创建时的版本。回滚同样通过激活旧版本完成。"
          />
          <label className="field-label">
            激活原因（必填）
            <Input.TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              showCount
              autoSize={{ minRows: 2, maxRows: 4 }}
              data-testid="activate-reason"
            />
          </label>
          {error !== null ? <Alert type="error" showIcon message={error} /> : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function ReleasesScreen({ admin }: { admin: AdminView }) {
  const [state, setState] = useState<AdminContentState | null>(null);
  const [releases, setReleases] = useState<AdminContentReleasesResponse | null>(null);
  const [target, setTarget] = useState<AdminReleaseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activation, setActivation] = useState<AdminContentActivation | null>(null);

  const canActivate = admin.permissions.includes('content.activate');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextState, nextReleases] = await Promise.all([
        adminApi.contentState(),
        adminApi.releases(),
      ]);
      setState(nextState);
      setReleases(nextReleases);
      setActivation(nextState.lastActivation);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取发布历史');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<AdminReleaseSummary> = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 210,
      render: (value: string, row) => (
        <Space>
          <strong>{value}</strong>
          {row.active ? <Tag color="green">已激活</Tag> : null}
        </Space>
      ),
    },
    {
      title: '变更',
      dataIndex: 'changeSummary',
      width: 140,
      render: (summary: AdminReleaseSummary['changeSummary']) =>
        `+${String(summary.added)} / -${String(summary.removed)} / ~${String(summary.changed)}`,
    },
    { title: '发布者', dataIndex: 'createdByUsername', width: 120 },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: 'checksum',
      dataIndex: 'checksum',
      width: 150,
      render: (value: string) => (
        <code className="mono" title={value}>
          {value.slice(0, 12)}…
        </code>
      ),
    },
    { title: '说明', dataIndex: 'note', ellipsis: true },
    {
      title: '',
      width: 100,
      render: (_value, row) =>
        canActivate && !row.active ? (
          <Button size="small" onClick={() => setTarget(row)}>
            激活
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <Space>
          {state?.previousRelease !== null && state?.previousRelease !== undefined ? (
            <Button onClick={() => setTarget(state.previousRelease)} disabled={!canActivate}>
              回滚到 {state.previousRelease.version}
            </Button>
          ) : null}
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      {error !== null ? <Alert type="error" showIcon message={error} /> : null}

      {state?.activeRelease !== null && state?.activeRelease !== undefined ? (
        <section className="panel panel-slim">
          <div className="kv-row">
            <span>当前激活</span>
            <strong>{state.activeRelease.version}</strong>
            <span>发布时间</span>
            <strong>{formatDateTime(state.activeRelease.createdAt)}</strong>
            <span>发布者</span>
            <strong>{state.activeRelease.createdByUsername}</strong>
          </div>
        </section>
      ) : (
        <Alert type="warning" showIcon message="当前没有激活内容版本，Room 使用代码基线。" />
      )}

      <section className="panel">
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={releases?.items ?? []}
          pagination={false}
          data-testid="releases-table"
        />
      </section>

      {activation !== null ? (
        <section className="panel panel-slim">
          <div className="kv-row">
            <span>最近激活</span>
            <strong>{shortId(activation.id)}</strong>
            <span>版本</span>
            <strong>{activation.releaseVersion}</strong>
            <span>操作者</span>
            <strong>{activation.activatedByUsername}</strong>
            <span>时间</span>
            <strong>{formatDateTime(activation.createdAt)}</strong>
          </div>
          <p className="muted-text">原因：{activation.reason}</p>
        </section>
      ) : null}

      <ActivateModal
        target={target}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          void load();
        }}
      />
    </div>
  );
}
