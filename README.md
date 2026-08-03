# 蛙宝 AI 工作台（WaBao AI Workspace）

> 文、图、声一体的多模态 AI 工作台 · P1 文本 + P2 图像阶段全栈实现（Next.js + NestJS + PostgreSQL，SSE 流式对话、模板创作、AI 绘图与看图问答、内容审核、JWT 鉴权）

<p>
  <img alt="stack" src="https://img.shields.io/badge/frontend-Next.js%2015%20%2B%20SWR-000000">
  <img alt="stack" src="https://img.shields.io/badge/backend-NestJS%20%2B%20Prisma-e0234e">
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL%2016-336791">
  <img alt="ai" src="https://img.shields.io/badge/AI-OpenAI%20%7C%20mock-412991">
</p>

**仓库名**：`wabao-ai-workspace` · **Topics**：`ai` `llm` `openai` `nestjs` `nextjs` `react` `swr` `typescript` `prisma` `postgresql` `sse` `fullstack` `multimodal`

本仓库汇总了「蛙宝 AI 工作台」项目的**全部内容**：产品/设计/架构文档 + 可运行的前端原型 + NestJS 后端 + 一键启动脚本。

## 目录结构

```
wabao-ai/
├── README.md                 # 本文件（项目总览）
├── issue/                    # 文档（按“时间+文件名”命名）
│   ├── 2026-07-21-16_15-产品设计文档.md
│   ├── 2026-07-21-16_15-P1-文本阶段-原型与接口设计.md
│   ├── 2026-07-31-P2-图像阶段-原型与接口设计.md
│   └── 2026-07-21-16_15-技术架构决策-前后端与选型.md
├── apps/
│   ├── api/                  # P1 后端 API（NestJS + TS + Prisma + PostgreSQL）
│   └── web/                  # P1 前端（Next.js 15 App Router + SWR + Tailwind v4）
└── packages/
    └── shared/               # 前后端共享契约（@wabao/shared：模型 / 会员套餐 / 常量）
```

> 采用 pnpm workspace：根目录 `pnpm install` 一次性安装 `apps/*`、`packages/*`；`@wabao/shared` 为前后端唯一契约来源，避免常量漂移。
> 前端服务端状态统一由 **SWR** 管理（`apps/web/lib/hooks.ts`），SSE 流式增量直接写入 SWR 缓存。

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [产品设计文档](./issue/2026-07-21-16_15-产品设计文档.md) | 主 PRD：能力全景、定位、12 模块、路线图 |
| [P1 原型与接口设计](./issue/2026-07-21-16_15-P1-文本阶段-原型与接口设计.md) | P1 文本阶段：页面原型 + REST/SSE 接口 + 数据模型 |
| [P2 原型与接口设计](./issue/2026-07-31-P2-图像阶段-原型与接口设计.md) | P2 图像阶段：AI 绘图 / 变体重绘 / 看图问答 + 图像配额 |
| [技术架构决策](./issue/2026-07-21-16_15-技术架构决策-前后端与选型.md) | 前后端分离、后端选型、monorepo 与可维护/扩容 |
| [本地启动与前后端对接指南](./issue/2026-07-22-14_26-本地启动与前后端对接指南.md) | 👉 从零安装软件到跑通全链路的保姆级教程（含 FAQ） |
| [查看数据库内容的四种方式](./issue/2026-07-22-15_20-查看数据库内容的四种方式.md) | Prisma Studio / psql / Docker Desktop / GUI 客户端 |

## 快速开始

> 前置：已安装 [Node.js ≥ 20](https://nodejs.org)、[pnpm](https://pnpm.io)（`corepack enable`）、[Docker Desktop](https://www.docker.com/products/docker-desktop/)。
> Windows 首次用 Docker 需先 `wsl --install` 并重启。详细图文见 👉 [本地启动与前后端对接指南](./issue/2026-07-22-14_26-本地启动与前后端对接指南.md)。

### 一键初始化（推荐）

在**项目根目录**执行，脚本会自动：复制 `.env`、安装前后端依赖、起数据库、建表并注入模板。

```bash
pnpm setup
```

然后分别启动前后端：

```bash
pnpm dev:api     # 后端 http://localhost:3001/api/v1
pnpm dev:web     # 前端 http://localhost:5173
```

浏览器打开 http://localhost:5173，点「去注册」创建账号即可使用。

### 根目录常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm setup` | 一键初始化（env + 依赖 + 数据库） |
| `pnpm dev:api` / `pnpm dev:web` | 启动后端 / 前端 |
| `pnpm db:up` / `pnpm db:down` | 启动 / 停止数据库容器 |
| `pnpm db:init` | 建表 + 注入模板（Docker 已在运行时） |
| `pnpm db:studio` | 打开 Prisma Studio 可视化查看数据库 |
| `pnpm test` / `pnpm test:e2e` | 后端单元 / 端到端测试 |
| `pnpm build` | 构建前后端 |

### 环境变量与密钥

- 各应用的密钥/连接串放在 **`.env`**（已被 `.gitignore` 忽略，不会上传），克隆后由 `pnpm setup` 从 `.env.example` 自动生成。
- 想接真实大模型：在 `apps/api/.env` 填 `OPENAI_API_KEY`（留空则自动走 mock，链路照样通）。
- 生产环境请务必修改 `apps/api/.env` 里的 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`。
- 前端 `apps/web/.env` 用 `API_INTERNAL_URL` 指向后端（仅服务端可见）；浏览器统一走同源 `/bff` 代理，登录令牌存于 **httpOnly cookie**，JS 不可读，`/app/*` 由中间件 + 服务端组件双重守卫。

## 产品概要

- **定位**：文、图、声一体的多模态 AI 工作台。
- **落地节奏**：P1 文本 → P2 图像 → P3 语音 → P4 深化。
- **技术栈**：前端 Next.js 15（App Router）+ SWR + TS + Tailwind v4；后端 NestJS（TS）；pnpm monorepo。

> 文档命名约定：`issue/` 下按 `YYYY-MM-DD-HH_MM-<文件名>.md` 归档。
