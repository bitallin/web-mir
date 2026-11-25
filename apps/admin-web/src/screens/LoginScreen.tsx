import { Alert, Button, Input } from 'antd';
import { useState, type FormEvent } from 'react';

import { AdminApiError, adminApi } from '../api/adminClient';
import type { AdminView } from '@web-legend/contracts';

type LoginScreenProps = {
  onLogin: (admin: AdminView) => void;
};

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await adminApi.login(username.trim(), password);
      onLogin(result.admin);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : '无法连接管理后台，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-stage">
      <div className="login-panel">
        <div className="login-brand">
          <span>WEB LEGEND</span>
          <small>OPERATIONS</small>
        </div>
        <h1>运营控制台</h1>
        <p className="login-copy">
          玩家、世界实例、内容发布与审计。所有写操作都会记录操作者与原因。
        </p>

        <form onSubmit={(event) => void submit(event)} className="login-form">
          <label htmlFor="admin-username">管理员账号</label>
          <Input
            id="admin-username"
            size="large"
            autoComplete="username"
            value={username}
            data-testid="admin-username"
            onChange={(event) => setUsername(event.target.value)}
          />

          <label htmlFor="admin-password">密码</label>
          <Input.Password
            id="admin-password"
            size="large"
            autoComplete="current-password"
            value={password}
            data-testid="admin-password"
            onChange={(event) => setPassword(event.target.value)}
          />

          {error !== null ? (
            <Alert
              type="error"
              showIcon
              message={error}
              data-testid="admin-login-error"
              style={{ marginTop: 4 }}
            />
          ) : null}

          <Button
            type="primary"
            size="large"
            htmlType="submit"
            loading={submitting}
            disabled={username.trim().length < 3 || password.length < 8}
            data-testid="admin-login-submit"
            className="login-submit"
          >
            进入控制台
          </Button>
        </form>

        <p className="login-footnote">管理员身份与玩家账号完全分离；控制台会话 8 小时有效。</p>
      </div>
    </div>
  );
}
