import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';

import type {
  AdminAuditEntry,
  AdminCommandView,
  AdminItemView,
  AdminPlayerDetail,
  AdminPlayerSummary,
  AdminPlayersResponse,
  AdminView,
} from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import {
  CLASS_LABELS,
  COMMAND_STATUS_TONE,
  formatDateTime,
  relativeTime,
  shortId,
} from '../lib/format';

type ActionType = 'kick' | 'ban' | 'mute';

const ACTION_COPY: Record<ActionType, { title: string; impact: string; confirm: string }> = {
  kick: {
    title: '踢下线',
    impact: '立即断开会话；角色位置会正常保存，玩家可以重新进入。',
    confirm: '确认踢下线',
  },
  ban: {
    title: '封禁账号',
    impact: '账号状态变为封禁；所有在线角色会被断开，且无法再次登录。',
    confirm: '确认封禁',
  },
  mute: {
    title: '禁言',
    impact: '目标账号下所有角色在指定时长内不能发送聊天；不影响移动与战斗。',
    confirm: '确认禁言',
  },
};

function PlayerActionModal({
  target,
  type,
  onClose,
  onDone,
}: {
  target: AdminPlayerSummary | null;
  type: ActionType | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = AntApp.useApp();
  const [reason, setReason] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = type === null ? null : ACTION_COPY[type];

  const submit = async (): Promise<void> => {
    if (target === null || type === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (type === 'kick') {
        await adminApi.kick(target.characterId, reason.trim());
      } else if (type === 'ban') {
        await adminApi.ban(target.characterId, reason.trim());
      } else {
        await adminApi.mute(target.characterId, reason.trim(), durationSeconds);
      }
      message.success(`${copy?.title ?? '操作'}指令已提交`);
      setReason('');
      onDone();
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={type !== null && target !== null}
      title={copy?.title}
      okText={copy?.confirm}
      okButtonProps={{ danger: type === 'ban', disabled: reason.trim().length < 2 }}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => void submit()}
      onCancel={() => {
        setError(null);
        setReason('');
        onClose();
      }}
      destroyOnHidden
      data-testid="player-action-modal"
    >
      {target !== null && copy !== null ? (
        <div className="action-modal">
          <p className="action-target">
            目标：<strong>{target.name}</strong> · {CLASS_LABELS[target.classId] ?? target.classId}{' '}
            Lv.{target.level} · {target.online ? '在线' : '离线'}
          </p>
          <Alert type="warning" showIcon message={copy.impact} />
          {type === 'mute' ? (
            <label className="field-label">
              禁言时长
              <Select
                value={durationSeconds}
                style={{ width: '100%' }}
                onChange={setDurationSeconds}
                options={[
                  { value: 3600, label: '1 小时' },
                  { value: 21_600, label: '6 小时' },
                  { value: 86_400, label: '24 小时' },
                  { value: 604_800, label: '7 天' },
                ]}
              />
            </label>
          ) : null}
          <label className="field-label">
            操作原因（必填，写入审计）
            <Input.TextArea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              showCount
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="例如：玩家举报使用外挂，已复核战斗日志"
              data-testid="player-action-reason"
            />
          </label>
          {error !== null ? <Alert type="error" showIcon message={error} /> : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function PlayersScreen({ admin }: { admin: AdminView }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'banned' | undefined>();
  const [online, setOnline] = useState<'true' | 'false' | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminPlayersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminPlayerSummary | null>(null);
  const [detail, setDetail] = useState<AdminPlayerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionType, setActionType] = useState<ActionType | null>(null);

  const canAct = admin.permissions.includes('players.action');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await adminApi.players({
        ...(query.length === 0 ? {} : { query }),
        ...(status === undefined ? {} : { status }),
        ...(online === undefined ? {} : { online }),
        page,
        pageSize: 25,
        sortBy: 'updatedAt',
        sortDir: 'desc',
      });
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取玩家列表');
    } finally {
      setLoading(false);
    }
  }, [online, page, query, status]);

  const openDetail = useCallback(async (characterId: string): Promise<void> => {
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await adminApi.player(characterId));
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取角色详情');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selected !== null) {
      void openDetail(selected.characterId);
    }
  }, [selected, openDetail]);

  const columns: ColumnsType<AdminPlayerSummary> = [
    {
      title: '角色',
      dataIndex: 'name',
      render: (name: string, row) => (
        <div className="player-cell">
          <strong>{name}</strong>
          <span className="mono muted-text">{shortId(row.characterId)}</span>
        </div>
      ),
    },
    {
      title: '职业 / 等级',
      width: 120,
      render: (_value, row) => (
        <span>
          {CLASS_LABELS[row.classId] ?? row.classId} · Lv.{row.level}
        </span>
      ),
    },
    {
      title: '地图',
      dataIndex: 'mapId',
      width: 140,
      render: (mapId: string) => <span className="map-label">{mapId}</span>,
    },
    {
      title: '账号',
      dataIndex: 'username',
      width: 150,
      render: (username: string, row) => (
        <span>
          {username}
          {row.accountStatus === 'banned' ? (
            <Tag color="red" style={{ marginLeft: 6 }}>
              封禁
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      title: '状态',
      width: 110,
      render: (_value, row) => (
        <span className={row.online ? 'status-online' : 'status-offline'}>
          {row.online ? '在线' : '离线'}
        </span>
      ),
    },
    {
      title: '最后更新',
      dataIndex: 'updatedAt',
      width: 120,
      render: (value: string) => relativeTime(value),
    },
  ];

  const inventoryColumns: ColumnsType<AdminItemView> = [
    { title: '物品', dataIndex: 'name' },
    {
      title: '模板',
      dataIndex: 'templateId',
      render: (value: string) => <code className="mono">{value}</code>,
    },
    { title: '数量', dataIndex: 'quantity', width: 70 },
    {
      title: '槽位',
      width: 80,
      render: (_value, row) => (row.equipSlot !== null ? row.equipSlot : (row.slotIndex ?? '—')),
    },
  ];

  const auditColumns: ColumnsType<AdminAuditEntry> = [
    { title: '动作', dataIndex: 'action', width: 120 },
    {
      title: '操作者',
      dataIndex: 'actorUsername',
      width: 110,
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 80,
      render: (result: string) => (
        <Tag color={result === 'success' ? 'green' : 'red'}>
          {result === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
  ];

  const commandColumns: ColumnsType<AdminCommandView> = [
    { title: '类型', dataIndex: 'type', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: AdminCommandView['status']) => (
        <Tag color={COMMAND_STATUS_TONE[value]}>{value}</Tag>
      ),
    },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (value: string) => formatDateTime(value),
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="角色名或账号"
            style={{ width: 240 }}
            onSearch={(value) => {
              setQuery(value.trim());
              setPage(1);
            }}
            data-testid="player-search"
          />
          <Select
            allowClear
            placeholder="账号状态"
            style={{ width: 120 }}
            value={status}
            onChange={(value: 'active' | 'banned' | undefined) => {
              setStatus(value);
              setPage(1);
            }}
            options={[
              { value: 'active', label: '正常' },
              { value: 'banned', label: '封禁' },
            ]}
          />
          <Select
            allowClear
            placeholder="在线状态"
            style={{ width: 120 }}
            value={online}
            onChange={(value: 'true' | 'false' | undefined) => {
              setOnline(value);
              setPage(1);
            }}
            options={[
              { value: 'true', label: '在线' },
              { value: 'false', label: '离线' },
            ]}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      {error !== null ? <Alert type="error" showIcon message={error} /> : null}

      <section className="panel">
        <Table
          size="small"
          rowKey="characterId"
          loading={loading}
          columns={columns}
          dataSource={data?.items ?? []}
          onRow={(row) => ({
            onClick: () => setSelected(row),
          })}
          rowClassName={(row) => (row.online ? 'row-online' : '')}
          pagination={{
            current: page,
            pageSize: 25,
            total: data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          data-testid="players-table"
        />
      </section>

      <Drawer
        open={selected !== null}
        width={760}
        title={
          selected === null ? '角色详情' : `${selected.name} · ${shortId(selected.characterId)}`
        }
        onClose={() => {
          setSelected(null);
          setDetail(null);
        }}
        extra={
          canAct && selected !== null && detail !== null ? (
            <Space>
              <Button size="small" onClick={() => setActionType('kick')}>
                踢下线
              </Button>
              <Button size="small" onClick={() => setActionType('mute')}>
                禁言
              </Button>
              <Button size="small" danger onClick={() => setActionType('ban')}>
                封禁
              </Button>
            </Space>
          ) : null
        }
        data-testid="player-drawer"
      >
        {detailLoading ? (
          <div className="screen-loading">
            <Spin />
          </div>
        ) : detail === null ? (
          <p className="muted-text">选择一名角色查看详情。</p>
        ) : (
          <div className="drawer-stack">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="账号">{detail.account.username}</Descriptions.Item>
              <Descriptions.Item label="账号状态">
                {detail.account.status === 'active' ? '正常' : '封禁'}
              </Descriptions.Item>
              <Descriptions.Item label="地图">{detail.character.mapId}</Descriptions.Item>
              <Descriptions.Item label="在线">
                {detail.character.online ? '是' : '否'}
              </Descriptions.Item>
              <Descriptions.Item label="等级 / 经验">
                Lv.{detail.character.level} · {detail.character.exp}
              </Descriptions.Item>
              <Descriptions.Item label="HP / MP">
                {detail.character.hp}/{detail.character.maxHp} · {detail.character.mp}/
                {detail.character.maxMp}
              </Descriptions.Item>
              <Descriptions.Item label="金币">{detail.wallet.balance}</Descriptions.Item>
              <Descriptions.Item label="坐标">
                {detail.character.x},{detail.character.y}
              </Descriptions.Item>
              <Descriptions.Item label="禁言到期">
                {formatDateTime(detail.account.mutedUntil)}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatDateTime(detail.character.createdAt)}
              </Descriptions.Item>
            </Descriptions>

            <section className="subpanel">
              <h3>装备</h3>
              <div className="equipment-row">
                <span>武器：{detail.equipment.weapon?.name ?? '—'}</span>
                <span>护甲：{detail.equipment.armor?.name ?? '—'}</span>
              </div>
            </section>

            <section className="subpanel">
              <h3>背包（{detail.inventory.length} 件）</h3>
              <Table
                size="small"
                rowKey="itemId"
                columns={inventoryColumns}
                dataSource={detail.inventory}
                pagination={false}
                locale={{ emptyText: '背包为空' }}
              />
            </section>

            <section className="subpanel">
              <h3>最近审计</h3>
              <Table
                size="small"
                rowKey="id"
                columns={auditColumns}
                dataSource={detail.recentAudit}
                pagination={false}
                locale={{ emptyText: '没有针对该角色的审计记录' }}
              />
            </section>

            <section className="subpanel">
              <h3>最近运营指令</h3>
              <Table
                size="small"
                rowKey="id"
                columns={commandColumns}
                dataSource={detail.recentCommands}
                pagination={false}
                locale={{ emptyText: '没有运营指令' }}
              />
            </section>
          </div>
        )}
      </Drawer>

      <PlayerActionModal
        target={selected}
        type={actionType}
        onClose={() => setActionType(null)}
        onDone={() => {
          setActionType(null);
          if (selected !== null) {
            void openDetail(selected.characterId);
          }
          void load();
        }}
      />
    </div>
  );
}
