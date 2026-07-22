# 蛙宝 AI 工作台 · 后端 API（P1 文本阶段）

> NestJS + TypeScript + Prisma + PostgreSQL。实现《P1 原型与接口设计》的 M1 对话、M3 创作、M9 审核、M12 账户四大模块。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | NestJS 10 |
| 语言 | TypeScript |
| ORM | Prisma 5 |
| 数据库 | PostgreSQL |
| 鉴权 | JWT（access + refresh，refresh 可轮换/失效） |
| AI | OpenAI 官方 Node SDK（Responses API + Moderation）；**未配置 Key 时自动进入 mock 模式** |
| 流式 | SSE（text/event-stream） |

## 目录结构

```
apps/api/
├── prisma/
│   ├── schema.prisma      # 数据模型（对应设计文档第六节）
│   └── seed.ts            # 注入平台级模板
├── src/
│   ├── main.ts            # 启动入口（全局前缀 /api/v1、CORS、校验、错误包装）
│   ├── app.module.ts
│   ├── health.controller.ts
│   ├── prisma/            # PrismaService（全局）
│   ├── common/            # 守卫 / 拦截器 / 过滤器 / 错误码 / SSE / AbortRegistry
│   ├── ai/                # AI 编排层：openai 客户端 + 模型路由 + Prompt + 流式
│   └── modules/
│       ├── auth/          # M12 认证：register/login/refresh/logout
│       ├── users/         # M12 用户与用量：/users/me、/usage、UsageService
│       ├── assistants/    # M1 助手人设 CRUD
│       ├── conversations/ # M1 会话与消息（SSE 流式对话、regenerate、stop、feedback）
│       ├── creations/     # M3 模板与创作（含结构化输出）
│       └── moderation/    # M9 审核（内嵌能力）
└── docker-compose.yml     # 一键起 PostgreSQL + Redis
```

## 快速开始

### 1. 准备环境变量

```bash
cd apps/api
cp .env.example .env   # Windows PowerShell: copy .env.example .env
```

`.env` 关键项：
- `DATABASE_URL`：PostgreSQL 连接串。
- `OPENAI_API_KEY`：**留空即可**，后端会以 mock 模式返回模拟流式内容，方便无 Key 本地跑通全链路。

### 2. 启动数据库

任选其一：

- **Docker**（推荐）：`docker compose up -d`（会起 Postgres + Redis）。
- **本地/云 Postgres**：自行准备一个 PostgreSQL（如 Neon / Supabase 免费实例），把连接串填入 `DATABASE_URL`。

### 3. 建表 + 注入模板

```bash
pnpm prisma:generate     # 生成 Prisma Client（安装后已自动执行一次）
pnpm prisma:push         # 按 schema 建表（开发期）；生产用 pnpm prisma:migrate
pnpm seed                # 注入 6 个内容创作模板
```

### 4. 启动服务

```bash
pnpm start:dev           # http://localhost:3001/api/v1
```

健康检查：`GET http://localhost:3001/api/v1/health` → 返回 `ai_mode: mock | openai`。

## 接口一览（Base URL: `/api/v1`）

| 模块 | 方法与路径 |
| --- | --- |
| 认证 M12 | `POST /auth/register`、`/auth/login`、`/auth/refresh`、`/auth/logout` |
| 用户 M12 | `GET/PATCH /users/me`、`GET /usage?period=YYYY-MM` |
| 助手 M1 | `GET/POST /assistants`、`GET/PATCH/DELETE /assistants/:id` |
| 会话 M1 | `GET/POST /conversations`、`GET/PATCH/DELETE /conversations/:id`、`GET /conversations/:id/messages` |
| 对话 M1 | `POST /conversations/:id/messages`（SSE）、`POST /messages/:id/regenerate`、`/stop`、`/feedback` |
| 创作 M3 | `GET /templates`、`GET /templates/:id`、`POST /creations`（SSE）、`GET /creations`、`GET/DELETE /creations/:id` |

- **成功响应**：`{ "data": ... }`；**错误响应**：`{ "error": { code, message, details? } }`。
- **鉴权**：除 `/auth/*`、`/health`、`/templates*` 外均需 `Authorization: Bearer <access_token>`。
- **流式**：`POST /conversations/:id/messages` 与 `POST /creations` 默认走 SSE；传 `{"stream": false}` 则返回一次性 JSON。

### SSE 事件

```
event: message.start   data: {"message_id":"...","role":"assistant"}
event: message.delta   data: {"text":"增量文本"}
event: message.done    data: {"finish_reason":"stop","usage":{"input_tokens":30,"output_tokens":180}}
event: error           data: {"code":"content_flagged","message":"...","details":{...}}
```

## 快速自测（mock 模式）

```bash
# 注册
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@wabao.ai","password":"demo1234","name":"体验用户"}'

# 用返回的 access_token 建会话
curl -X POST http://localhost:3001/api/v1/conversations \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"title":"新会话","model":"gpt-5.6-terra"}'

# 发消息（SSE 流式）
curl -N -X POST http://localhost:3001/api/v1/conversations/<CV_ID>/messages \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"content":"你好，帮我写一段周报","stream":true}'
```

## 自动化测试

```bash
pnpm test        # 单元测试（无需数据库，21 个用例）
pnpm test:e2e    # 端到端测试（需可连接的 PostgreSQL + 已 seed）
```

- **单元测试**（`src/**/*.spec.ts`）：覆盖 AI 编排层（模型校验/token 与成本估算/模型路由/Prompt 组装/mock 流式）、M9 审核本地回退、M12 用量计量。**无需数据库，随处可跑**。
- **端到端测试**（`test/app.e2e-spec.ts`）：覆盖注册→鉴权→会话→（非流式）对话→创作→结构化输出→审核拦截→用量计量完整链路。运行前需：`docker compose up -d`（或任意 Postgres）+ `pnpm prisma:push` + `pnpm seed`。

## 关于 Docker

- 已安装 **Docker Desktop**。其 Linux 引擎依赖 **WSL2**；若首次使用报「引擎未启动」，请以管理员运行 `wsl --install` 并**重启**，随后启动 Docker Desktop 即可 `docker compose up -d`。
- 若不便使用 Docker：可安装原生 Windows 版 PostgreSQL，或使用云 Postgres（Neon/Supabase），把连接串填入 `.env` 的 `DATABASE_URL` 即可运行迁移、seed 与 e2e。

## 说明

- **M9 审核**为内嵌能力，对话/创作在调用模型前后自动执行；无 Key 时用本地关键词（如「暴力/违法」）演示拦截。
- **用量计量**：每次对话/创作按估算 token 写入 `UsageRecord`，`GET /usage` 聚合展示。
- **停止生成**：单实例内基于 `AbortController` 实现；多实例部署需改为共享状态（Redis）。
- 接入真实模型：在 `.env` 填 `OPENAI_API_KEY`（可选 `OPENAI_BASE_URL`、`OPENAI_MODEL`，默认 `gpt-4o-mini`）。
