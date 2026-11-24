import { useEffect, useRef } from 'react';

import { createBootGame } from './game/createBootGame';
import { useControlApiHealth, type ServiceState } from './lib/health';

const STATUS_LABEL: Record<ServiceState, string> = {
  checking: '检测中',
  online: '在线',
  degraded: '降级',
  offline: '离线',
};

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { health, refresh } = useControlApiHealth();

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const game = createBootGame(container);
    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div className="shell">
      <div className="canvas-layer" ref={containerRef} aria-hidden="true" />

      <header className="hud hud-top">
        <div className="brand">
          <p className="eyebrow">浏览器原生 · 多人在线</p>
          <h1>Web Legend</h1>
          <p className="phase">
            工程底座 <span>阶段 0</span>
          </p>
        </div>

        <section className={`service service-${health.state}`} aria-live="polite">
          <div className="service-heading">
            <span className="service-label">Control API</span>
            <span className="service-value">{STATUS_LABEL[health.state]}</span>
          </div>
          <p className="service-detail">{health.detail}</p>
          <button type="button" className="service-refresh" onClick={refresh}>
            重新检测
          </button>
        </section>
      </header>

      <footer className="hud hud-bottom">
        <p>协议 v1</p>
        <p>本阶段不加载任何游戏内容</p>
        <p>Phaser 4.2 · React 19 · Colyseus 0.18</p>
      </footer>
    </div>
  );
}
