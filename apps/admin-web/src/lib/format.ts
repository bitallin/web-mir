import type { AdminCommandStatus, AdminRole } from '@web-legend/contracts';

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return value;
  }
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1_000));
  if (seconds < 60) {
    return `${String(seconds)} 秒前`;
  }
  if (seconds < 3_600) {
    return `${String(Math.round(seconds / 60))} 分钟前`;
  }
  if (seconds < 86_400) {
    return `${String(Math.round(seconds / 3_600))} 小时前`;
  }
  return `${String(Math.round(seconds / 86_400))} 天前`;
}

export function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${String(seconds)} 秒`;
  }
  if (seconds < 3_600) {
    return `${String(Math.round(seconds / 60))} 分钟`;
  }
  if (seconds < 86_400) {
    return `${String(Math.round(seconds / 3_600))} 小时`;
  }
  return `${String(Math.round(seconds / 86_400))} 天`;
}

export const CLASS_LABELS: Record<string, string> = {
  warrior: '战士',
  mage: '法师',
  taoist: '道士',
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: '超级管理员',
  ops_admin: '运营管理员',
  game_master: '游戏管理员',
  content_designer: '内容策划',
  release_approver: '发布审批',
  analyst: '数据分析',
  readonly_auditor: '只读审计',
};

export const COMMAND_STATUS_TONE: Record<AdminCommandStatus, string> = {
  pending: 'gold',
  dispatched: 'blue',
  applied: 'green',
  failed: 'red',
};
