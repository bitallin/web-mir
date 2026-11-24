import { loginRequestSchema } from '@web-legend/contracts';
import { useState, type FormEvent } from 'react';

import type { Credentials } from '../api/client';

type AuthMode = 'login' | 'register';

export type AuthScreenProps = {
  pending: boolean;
  error: string | null;
  onLogin: (credentials: Credentials) => Promise<boolean>;
  onRegister: (credentials: Credentials) => Promise<boolean>;
  onClearError: () => void;
};

export function AuthScreen({ pending, error, onLogin, onRegister, onClearError }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const switchMode = (next: AuthMode): void => {
    setMode(next);
    setLocalError(null);
    onClearError();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? '请输入有效的账号和密码');
      return;
    }

    const action = mode === 'login' ? onLogin : onRegister;
    void action(parsed.data);
  };

  return (
    <div className="entry-shell">
      <div className="entry-atmosphere" aria-hidden="true">
        <div className="entry-glow" />
        <div className="entry-grid" />
      </div>

      <main className="entry-card">
        <header className="entry-brand">
          <p className="eyebrow">浏览器原生 · 服务端权威</p>
          <h1>Web Legend</h1>
          <p className="entry-tagline">踏入经典大陆，从一段传奇开始。</p>
        </header>

        <div className="entry-tabs" role="tablist" aria-label="账号方式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              switchMode('login');
            }}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              switchMode('register');
            }}
          >
            注册
          </button>
        </div>

        <form className="entry-form" onSubmit={submit}>
          <label>
            <span>账号</span>
            <input
              data-testid="auth-username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setLocalError(null);
                onClearError();
              }}
              placeholder="3–24 位字母、数字或下划线"
              maxLength={24}
              disabled={pending}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              data-testid="auth-password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setLocalError(null);
                onClearError();
              }}
              placeholder="至少 8 位"
              maxLength={128}
              disabled={pending}
            />
          </label>

          {localError !== null || error !== null ? (
            <p className="entry-error" data-testid="auth-error" role="alert">
              {localError ?? error}
            </p>
          ) : null}

          <button
            type="submit"
            className="entry-submit"
            data-testid="auth-submit"
            disabled={pending}
          >
            {pending ? '请稍候…' : mode === 'login' ? '进入账号' : '创建账号'}
          </button>
        </form>

        <p className="entry-footnote">
          账号密码由服务端校验（Argon2id），游戏世界只接受一次性进入票据。
        </p>
      </main>
    </div>
  );
}
