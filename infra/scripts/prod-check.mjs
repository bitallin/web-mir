import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

const results = [];
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://localhost:38443';

function call(options, body) {
  return new Promise((resolve, reject) => {
    const transport = options.protocol === 'http:' ? httpRequest : httpsRequest;
    const finalOptions =
      options.protocol === 'https:' ? { ...options, servername: 'edge' } : options;
    const req = transport(finalOptions, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`);
}

async function main() {
  const game = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/healthz',
    method: 'GET',
  });
  record('edge https healthz', game.status === 200 && game.body.trim() === 'ok', `${game.status}`);

  const gamePage = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/',
    method: 'GET',
  });
  record(
    'game web over https',
    gamePage.status === 200 && gamePage.body.includes('<div id="root"'),
    `${gamePage.status}, csp=${gamePage.headers['content-security-policy'] !== undefined}, hsts=${gamePage.headers['strict-transport-security'] !== undefined}, xfo=${gamePage.headers['x-frame-options']}`,
  );
  record(
    'security headers present',
    gamePage.headers['strict-transport-security'] !== undefined &&
      gamePage.headers['content-security-policy'] !== undefined &&
      gamePage.headers['x-content-type-options'] === 'nosniff',
  );

  const adminPage = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8444,
    path: '/',
    method: 'GET',
  });
  record(
    'admin web over https',
    adminPage.status === 200 && adminPage.body.includes('<div id="root"'),
    `${adminPage.status}`,
  );

  const api = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/api/v1',
    method: 'GET',
  });
  record(
    'control api proxied',
    api.status === 200 && api.body.includes('control-api'),
    `${api.status} ${api.body.slice(0, 60)}`,
  );

  const ready = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/health/ready',
    method: 'GET',
  });
  record(
    'readiness through edge',
    ready.status === 200 && ready.body.includes('"ok"'),
    `${ready.status}`,
  );

  const internal = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/internal/admin/status',
    method: 'GET',
  });
  record('/internal not public', internal.status === 404, `${internal.status}`);

  const metrics = await call({
    protocol: 'https:',
    host: 'edge',
    port: 8443,
    path: '/metrics/prometheus',
    method: 'GET',
  });
  record('/metrics not public', metrics.status === 404, `${metrics.status}`);

  const loginBody = JSON.stringify({ username: 'nobody_here', password: 'wrong-password-1' });
  const login = await call(
    {
      protocol: 'https:',
      host: 'edge',
      port: 8443,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(loginBody),
        origin: PUBLIC_ORIGIN,
        host: new URL(PUBLIC_ORIGIN).host,
      },
    },
    loginBody,
  );
  record(
    'login reaches control api (401 for bad credentials)',
    login.status === 401,
    `${login.status} ${login.body.slice(0, 60)}`,
  );

  const redirect = await call({
    protocol: 'http:',
    host: 'edge',
    port: 8080,
    path: '/',
    method: 'GET',
  });
  record(
    'http redirects to https',
    redirect.status === 308 && String(redirect.headers.location ?? '').startsWith('https://'),
    `${redirect.status} ${redirect.headers.location ?? ''}`,
  );

  const wsStatus = await new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: 'edge',
      port: 8443,
      path: '/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Origin: PUBLIC_ORIGIN,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end();
  });
  record('wss upgrade through edge', wsStatus === 101, `${wsStatus}`);

  const targets = await call({
    protocol: 'http:',
    host: 'prometheus',
    port: 9090,
    path: '/api/v1/targets',
    method: 'GET',
  });
  const parsed = JSON.parse(targets.body);
  const active = parsed.data.activeTargets.map((target) => ({
    job: target.labels.job,
    health: target.health,
  }));
  const allUp = active.length >= 3 && active.every((target) => target.health === 'up');
  record('prometheus targets up', allUp, JSON.stringify(active));

  const failed = results.filter((entry) => !entry.ok);
  console.log(JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
