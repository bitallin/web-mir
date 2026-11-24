# ADR-014: Node 26 / TypeScript 5.9.3 / 精确依赖

- 状态：Accepted
- 日期：2026-11-24
- 关联：架构文档 0.2、版本纪律

## 背景

2026-11-24 核对官方版本时发现：

- Node.js 26.13.1 是当前 LTS；本机原为 Node 24.22.2。
- npm 上 `typescript@latest` 为 7.0.2，但 `typescript-eslint@8.74.0` 的 peer
  范围是 `>=4.8.4 <6.1.0`，尚不支持 TypeScript 7。
- Vitest 5、Vite 8、tsup 9 均要求 Node 22.18+/24.11+/26。
- Colyseus 0.18 要求 Node >=22，Schema 5，客户端包为 `@colyseus/sdk`。

## 决策

1. 开发与生产目标运行时锁定 Node.js 26 LTS；`engines` 为 `>=26 <27`。
   本机通过 nvm 安装 26.13.1，不替换系统 Node 24。
2. TypeScript 固定 5.9.3，而不是 7.0.2；等待 typescript-eslint 正式支持后再
   评估升级。
3. 所有依赖写精确版本，提交 `pnpm-lock.yaml`；CI 使用 frozen lockfile。
4. 前端 Vite 8.3.8、React 19.3.1、Phaser 4.2.1、AntD 6.7.2。
5. 后端 Fastify 5.12.8、Colyseus 0.18.28、Drizzle 0.45.4、Zod 4.6.7。
6. 测试使用 Vitest 5.1.1、Playwright 1.65.1。

## 理由

运行时与工具链必须互相支持。使用 `latest` 会引入未经验证的破坏性变更；TypeScript
7 与 lint 工具链不兼容会导致质量门禁失效。

## 影响

- 升级 TypeScript、ESLint、Vitest 或 Node 时必须成套验证。
- 本地环境若只有 Node 24，需要先安装 Node 26；CI 固定 26.13.1。
- 普通开发机可从 Docker Hub 拉取 `postgres:18.7-alpine`；当前受限环境使用
  本地镜像 PostgreSQL 18.3，仍属于 18.x。

## 未来调整条件

- typescript-eslint 支持 TypeScript 7 后，单独 ADR 评估迁移。
- Node 27 进入 LTS 后评估升级。
- 任何主版本升级必须通过 lint、typecheck、unit、integration、build 和 E2E。
