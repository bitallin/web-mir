import { Alert, App as AntApp, Button, Input, Space, Spin, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CONTENT_SECTIONS,
  CONTENT_SECTION_LABELS,
  type AdminContentDraftDetail,
  type AdminContentState,
  type AdminReleaseSummary,
  type AdminView,
  type ContentChange,
  type ContentSection,
  type ContentValidationReport,
} from '@web-legend/contracts';

import { AdminApiError, adminApi } from '../api/adminClient';
import { formatDateTime } from '../lib/format';

const ISSUE_TONE: Record<'error' | 'warning', string> = {
  error: 'red',
  warning: 'gold',
};

const CHANGE_LABELS: Record<ContentChange['kind'], string> = {
  added: '新增',
  removed: '删除',
  changed: '修改',
};

function releaseCard(release: AdminReleaseSummary | null) {
  if (release === null) {
    return (
      <div className="release-card">
        <span className="muted-text">当前没有激活内容版本，Room 使用代码基线。</span>
      </div>
    );
  }
  return (
    <div className="release-card">
      <div>
        <p className="release-label">当前激活版本</p>
        <strong>{release.version}</strong>
      </div>
      <div>
        <p className="release-label">checksum</p>
        <code className="mono" title={release.checksum}>
          {release.checksum.slice(0, 16)}…
        </code>
      </div>
      <div>
        <p className="release-label">发布者</p>
        <span>{release.createdByUsername}</span>
      </div>
      <div>
        <p className="release-label">发布时间</p>
        <span>{formatDateTime(release.createdAt)}</span>
      </div>
    </div>
  );
}

export function ContentScreen({ admin }: { admin: AdminView }) {
  const { message } = AntApp.useApp();
  const [state, setState] = useState<AdminContentState | null>(null);
  const [section, setSection] = useState<ContentSection>('lootTables');
  const [draft, setDraft] = useState<AdminContentDraftDetail | null>(null);
  const [editor, setEditor] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [report, setReport] = useState<ContentValidationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'validate' | 'publish' | null>(null);
  const [published, setPublished] = useState<AdminReleaseSummary | null>(null);

  const canWrite = admin.permissions.includes('content.write');
  const canValidate = admin.permissions.includes('content.validate');
  const canPublish = admin.permissions.includes('content.publish');

  const loadState = useCallback(async (): Promise<void> => {
    try {
      setState(await adminApi.contentState());
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取内容状态');
    }
  }, []);

  const loadDraft = useCallback(async (target: ContentSection): Promise<void> => {
    setLoading(true);
    try {
      const result = await adminApi.contentDraft(target);
      setDraft(result);
      setEditor(JSON.stringify(result.payload, null, 2));
      setError(null);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法读取内容草稿');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    void loadDraft(section);
  }, [loadDraft, section]);

  const parsed = useMemo((): Record<string, unknown> | string => {
    try {
      const value: unknown = JSON.parse(editor);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return '顶层必须是 JSON 对象';
      }
      return value as Record<string, unknown>;
    } catch {
      return 'JSON 语法错误';
    }
  }, [editor]);

  const entityCount = typeof parsed === 'string' ? null : Object.keys(parsed).length;

  const save = async (): Promise<void> => {
    if (typeof parsed === 'string') {
      setError(parsed);
      return;
    }
    if (reason.trim().length < 2) {
      setError('保存草稿需要填写原因（至少 2 个字符）');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      await adminApi.saveDraft(section, parsed, reason.trim());
      await Promise.all([loadState(), loadDraft(section)]);
      message.success('草稿已保存');
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? [caught.message, ...caught.details].join('；')
          : '保存失败',
      );
    } finally {
      setBusy(null);
    }
  };

  const validate = async (): Promise<void> => {
    setBusy('validate');
    setError(null);
    try {
      const result = await adminApi.validateContent();
      setReport(result);
      message.success(result.valid ? '校验通过' : '校验未通过，请查看问题列表');
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '校验请求失败');
    } finally {
      setBusy(null);
    }
  };

  const publish = async (): Promise<void> => {
    if (reason.trim().length < 2) {
      setError('发布需要填写原因（至少 2 个字符）');
      return;
    }
    setBusy('publish');
    setError(null);
    try {
      const result = await adminApi.publishContent(
        reason.trim(),
        note.trim().length === 0 ? undefined : note.trim(),
      );
      setPublished(result.release);
      setReport(result.validation);
      await loadState();
      message.success(`已发布版本 ${result.release.version}`);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? [caught.message, ...caught.details].join('；')
          : '发布失败',
      );
    } finally {
      setBusy(null);
    }
  };

  const changeColumns: ColumnsType<ContentChange> = [
    {
      title: '类型',
      dataIndex: 'section',
      width: 100,
      render: (value: ContentSection) => CONTENT_SECTION_LABELS[value],
    },
    {
      title: 'ID',
      dataIndex: 'id',
      render: (value: string) => <code className="mono">{value}</code>,
    },
    {
      title: '变化',
      dataIndex: 'kind',
      width: 80,
      render: (value: ContentChange['kind']) => <Tag>{CHANGE_LABELS[value]}</Tag>,
    },
    {
      title: '字段',
      dataIndex: 'fields',
      render: (fields: string[]) => (fields.length === 0 ? '—' : fields.join(', ')),
    },
  ];

  return (
    <div className="screen-stack">
      <div className="section-heading section-heading-actions">
        <div className="section-actions">
          <span className="muted-text">草稿 → 校验 → 不可变 Release → 激活</span>
        </div>
      </div>

      {error !== null ? (
        <Alert type="error" showIcon message={error} data-testid="content-error" />
      ) : null}
      {published !== null ? (
        <Alert
          type="success"
          showIcon
          message={`已创建不可变版本 ${published.version}`}
          description="新 Room 会在 Game Server 下一轮内容刷新后使用它；已有 Room 保持创建时的版本。请在发布中心激活或回滚。"
        />
      ) : null}

      {releaseCard(state?.activeRelease ?? null)}

      <div className="content-layout">
        <aside className="content-sections">
          <p className="panel-label">内容类型</p>
          {CONTENT_SECTIONS.map((entry) => {
            const summary = state?.drafts.find((draftEntry) => draftEntry.section === entry);
            return (
              <button
                key={entry}
                type="button"
                className={entry === section ? 'content-section active' : 'content-section'}
                onClick={() => setSection(entry)}
                data-testid={`content-section-${entry}`}
              >
                <span>{CONTENT_SECTION_LABELS[entry]}</span>
                <small>
                  {summary?.dirty === true ? '有改动' : summary === undefined ? '未编辑' : '已同步'}
                </small>
              </button>
            );
          })}
        </aside>

        <section className="content-editor">
          <div className="panel-heading">
            <h3>{CONTENT_SECTION_LABELS[section]}</h3>
            <span className="mono">
              {entityCount === null ? 'JSON 无效' : `${String(entityCount)} 个条目`}
              {draft?.updatedAt !== null && draft?.updatedAt !== undefined
                ? ` · ${formatDateTime(draft.updatedAt)}`
                : ''}
            </span>
          </div>

          {loading ? (
            <div className="screen-loading">
              <Spin />
            </div>
          ) : (
            <>
              <Input.TextArea
                className="json-editor"
                value={editor}
                onChange={(event) => setEditor(event.target.value)}
                spellCheck={false}
                autoSize={{ minRows: 18, maxRows: 30 }}
                data-testid="content-editor"
              />
              <div className="content-controls">
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="变更原因（必填，写入审计）"
                  maxLength={200}
                  data-testid="content-reason"
                />
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="发布说明（可选）"
                  maxLength={300}
                />
                <Space wrap>
                  <Button
                    onClick={() => void save()}
                    loading={busy === 'save'}
                    disabled={!canWrite || typeof parsed === 'string'}
                    data-testid="content-save"
                  >
                    保存草稿
                  </Button>
                  <Button
                    onClick={() => void validate()}
                    loading={busy === 'validate'}
                    disabled={!canValidate}
                    data-testid="content-validate"
                  >
                    校验全部草稿
                  </Button>
                  <Button
                    type="primary"
                    onClick={() => void publish()}
                    loading={busy === 'publish'}
                    disabled={!canPublish}
                    data-testid="content-publish"
                  >
                    发布新版本
                  </Button>
                </Space>
              </div>
            </>
          )}
        </section>
      </div>

      {report !== null ? (
        <section className="panel" data-testid="content-report">
          <div className="panel-heading">
            <h3>校验与差异</h3>
            <span className="mono">
              {report.valid ? 'VALID' : 'INVALID'} · 新增 {report.summary.added} · 删除{' '}
              {report.summary.removed} · 修改 {report.summary.changed}
            </span>
          </div>

          {report.issues.length === 0 ? (
            <p className="muted-text">没有发现问题。</p>
          ) : (
            <ul className="issue-list" data-testid="content-issues">
              {report.issues.slice(0, 100).map((entry, index) => (
                <li key={`${entry.path}-${String(index)}`}>
                  <Tag color={ISSUE_TONE[entry.severity]}>
                    {entry.severity === 'error' ? '错误' : '警告'}
                  </Tag>
                  <code className="mono">{entry.path}</code>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ul>
          )}

          <Table
            size="small"
            rowKey={(row) => `${row.section}:${row.id}:${row.kind}`}
            columns={changeColumns}
            dataSource={report.changes}
            pagination={{ pageSize: 8, size: 'small' }}
            locale={{ emptyText: '与当前激活版本没有差异' }}
            data-testid="content-changes"
          />
        </section>
      ) : null}
    </div>
  );
}
