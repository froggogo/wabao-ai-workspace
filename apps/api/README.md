# 蛙宝 AI 工作台 · 后端 API（P1 文本 + P2 图像阶段）

> NestJS + TypeScript + Prisma + PostgreSQL。实现《P1 原型与接口设计》的 M1 对话、M3 创作、M9 审核、M12 账户，以及《P2 原型与接口设计》的 M5 图像与多模态（生图 / 变体 / 看图问答 / 图生文案）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | NestJS 10 |
| 语言 | TypeScript |
| ORM | Prisma 5 |
| 数据库 | PostgreSQL |
| 鉴权 | JWT（access + refresh，refresh 可轮换/失效） |
| AI | OpenAI 官方 Node SDK（Responses / Images / Moderation）；**未配置 Key 时自动进入 mock 模式** |
| 流式 | SSE（text/event-stream） |
| 媒体存储 | 本地磁盘 + `/uploads` 静态托管（`StorageService` 已抽象，可切 S3） |

## 目录结构

```
apps/api/
├── prisma/
│   ├── schema.prisma      # 数据模型（对应设计文档第六节）
│   ├── seed.ts            # 注入平台级模板
│   └── sql/               # 幂等增量 SQL（用于不便跑 migrate 的共享库）
│       └── add_media_assets.sql   # P2：media_assets 表 + 枚举扩展 + messages.attachments
├── src/
│   ├── main.ts            # 启动入口（全局前缀 /api/v1、CORS、校验、错误包装、/uploads 静态托管）
│   ├── app.module.ts
│   ├── health.controller.ts
│   ├── prisma/            # PrismaService（全局）
│   ├── common/            # 守卫 / 拦截器 / 过滤器 / 错误码 / SSE / AbortRegistry
│   ├── ai/                # AI 编排层：openai 客户端 + 模型路由 + Prompt + 文本流 + 图像/视觉服务
│   └── modules/
│       ├── auth/          # M12 认证：register/login/refresh/logout
│       ├── users/         # M12 用户与用量：/users/me、/usage、UsageService
│       ├── assistants/    # M1 助手人设 CRUD
│       ├── conversations/ # M1 会话与消息（SSE 流式对话、regenerate、stop、feedback）
│       ├── creations/     # M3 模板与创作（含结构化输出）
│       ├── images/        # M5 图像：生图/变体/上传/看图问答/图生文案 + 存储 + 图像配额
│       └── moderation/    # M9 审核（内嵌能力）
├── uploads/               # 媒体文件落盘目录（已 gitignore，由 MEDIA_ROOT 配置）
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
- `OPENAI_API_KEY`：**留空即可**，后端会以 mock 模式返回模拟流式内容与占位图，方便无 Key 本地跑通全链路。
- `MEDIA_ROOT`：媒体落盘目录，默认 `uploads`（相对后端工作目录）。
- `MEDIA_PUBLIC_BASE_URL`：可公网访问的媒体前缀。**真实模式下做看图问答/图生文案时必填**（上游视觉模型需要能访问图片）；mock 模式留空即可。

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

这一步会创建 P2 图像模块所需的 **`media_assets` 表**、`MediaType` / `MediaSource` 枚举、`UsageFeature` 的 `image` / `vision` 取值，以及 `messages.attachments` 字段。

**验证图像相关结构是否就绪**：

```bash
# 方式一：查看 Prisma 认为的差异（输出为空说明数据库与 schema 一致）
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script

# 方式二：直接查库
psql "$DATABASE_URL" -c "\d media_assets"
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::\"UsageFeature\"));"
```

> **共享数据库 / 无法执行 migrate 的环境**：改用幂等增量脚本，可重复执行不报错：
> ```bash
> psql "$DATABASE_URL" -f prisma/sql/add_media_assets.sql
> ```
> 注意 `ALTER TYPE ... ADD VALUE` 在部分 PostgreSQL 版本中不能与其他语句共处一个事务，若报错请单独执行前两行。

### 4. 启动服务

```bash
pnpm start:dev           # http://localhost:3001/api/v1
```

健康检查：`GET http://localhost:3001/api/v1/health` → 返回 `ai_mode: mock | openai`。

生成的图片通过 `GET http://localhost:3001/uploads/<filename>` 访问；前端已配置 Next rewrite 做同源代理，页面中可直接用 `/uploads/xxx.png`。

## 接口一览（Base URL: `/api/v1`）

| 模块 | 方法与路径 |
| --- | --- |
| 认证 M12 | `POST /auth/register`、`/auth/login`、`/auth/refresh`、`/auth/logout` |
| 用户 M12 | `GET/PATCH /users/me`、`GET /usage?period=YYYY-MM`（含 `images` 图像额度） |
| 助手 M1 | `GET/POST /assistants`、`GET/PATCH/DELETE /assistants/:id` |
| 会话 M1 | `GET/POST /conversations`、`GET/PATCH/DELETE /conversations/:id`、`GET /conversations/:id/messages` |
| 对话 M1 | `POST /conversations/:id/messages`（SSE）、`POST /messages/:id/regenerate`、`/stop`、`/feedback` |
| 创作 M3 | `GET /templates`、`GET /templates/:id`、`POST /creations`（SSE）、`GET /creations`、`GET/DELETE /creations/:id` |
| **图像 M5** | `GET /images/options`、`POST /images/generations`（SSE）、`GET /images`、`GET/DELETE /images/:id`、`POST /images/:id/variations`、`POST /images/uploads`（multipart） |
| **多模态 M5** | `POST /images/analyses`（SSE 看图问答，可传 `conversation_id` 落库）、`GET /images/caption-options`、`POST /images/captions`（SSE 图生文案） |
| 静态资源 | `GET /uploads/:filename`（媒体文件，无需鉴权） |

- **成功响应**：`{ "data": ... }`；**错误响应**：`{ "error": { code, message, details? } }`。
- **鉴权**：除 `/auth/*`、`/health`、`/templates*`、`/uploads/*` 外均需 `Authorization: Bearer <access_token>`。
- **流式**：`POST /conversations/:id/messages`、`/creations`、`/images/generations`、`/images/analyses`、`/images/captions` 默认走 SSE；传 `{"stream": false}` 则返回一次性 JSON。
- **额度预警**：图像接口在响应头返回 `X-Quota-Remaining`（剩余可生成张数，不限量为 `unlimited`）。

### SSE 事件

文本类（对话 / 创作 / 看图问答 / 图生文案）：

```
event: message.start   data: {"message_id":"...","role":"assistant"}
event: message.delta   data: {"text":"增量文本"}
event: message.done    data: {"finish_reason":"stop","usage":{"input_tokens":30,"output_tokens":180}}
event: error           data: {"code":"content_flagged","message":"...","details":{...}}
```

图像类（生图 / 变体）：

```
event: image.start     data: {"count":2,"model":"gpt-image-2-mini","size":"1024x1024","mock":true}
event: image.item      data: {"id":"...","url":"/uploads/img_x.png","width":1024,"height":1024,...}
event: image.done      data: {"count":2,"images":[...],"quota":{"quota":20,"used":10,"remaining":10}}
```

## 数据模型要点（P2 图像）

| 表 / 字段 | 说明 |
| --- | --- |
| `media_assets` | 媒体资产。`source` 区分 `generation`/`variation`/`upload`；`source_id` 自引用构成**变体重绘链**；`flagged` 记录审核结果 |
| `messages.attachments` | JSONB 图片 URL 数组。看图问答传 `conversation_id` 时，带图提问会落此字段，刷新页面可回看 |
| `UsageFeature` | 新增 `image`（按张数）、`vision`（看图问答与图生文案，按等效 token） |
| `creations` | 图生文案复用此表，`template_id = 'image-caption'` |

> 数据库只存 `url` 引用，文件本体落在 `MEDIA_ROOT`；删除图片时 `StorageService` 会同步清理磁盘文件。

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

### 图像模块自测（验证是否真正写库）

```bash
# 1) 生图（非流式，便于直接看 JSON）
curl -X POST http://localhost:3001/api/v1/images/generations \
  -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Content-Type: application/json" \
  -d '{"prompt":"一只戴着宇航头盔的青蛙","size":"1024x1024","stream":false}'
# → data.images[0].url 形如 /uploads/img_xxx.svg；响应头含 X-Quota-Remaining

# 2) 确认已落库
curl http://localhost:3001/api/v1/images -H "Authorization: Bearer <ACCESS_TOKEN>"

# 3) 直接查数据库确认
psql "$DATABASE_URL" -c "SELECT id, source, url, model, size, width, height, flagged FROM media_assets ORDER BY created_at DESC LIMIT 5;"

# 4) 确认图片文件可访问
curl -I http://localhost:3001/uploads/<FILENAME>

# 5) 用量已按张数计入
curl http://localhost:3001/api/v1/usage -H "Authorization: Bearer <ACCESS_TOKEN>"
# → data.images = { quota, used, remaining, vision }
```

> 免费版仅可用 `gpt-image-2-mini`、单张、4 种基础风格；看图问答 / 变体 / 图生文案需 Plus 及以上，否则返回 403。

## 自动化测试

```bash
pnpm test        # 单元测试（无需数据库，212 个用例）
pnpm test:e2e    # 端到端测试（需可连接的 PostgreSQL + 已 seed）
```

- **单元测试**（`src/**/*.spec.ts`）：覆盖 AI 编排层（模型校验/token 与成本估算/模型路由/Prompt 组装/mock 流式）、M9 审核本地回退、M12 用量计量，以及 **P2 图像全链路**（契约目录自洽性、mock 出图确定性与 SVG 合法性、生图编排与权益/配额/审核、图像配额时间窗、存储防路径穿越、DTO 边界、看图问答落库、图生文案）。**无需数据库，随处可跑**。
- **端到端测试**（`test/app.e2e-spec.ts`）：覆盖 P1 链路（注册→鉴权→会话→对话→创作→审核→用量）与 **P2 图像链路**（生图→静态访问→作品列表→上传→删除；升级 Plus 后批量出图→变体重绘链→看图问答落库→图生文案入创作历史→越权保护）。运行前需：`docker compose up -d`（或任意 Postgres）+ `pnpm prisma:push` + `pnpm seed`。

## 关于 Docker

- 已安装 **Docker Desktop**。其 Linux 引擎依赖 **WSL2**；若首次使用报「引擎未启动」，请以管理员运行 `wsl --install` 并**重启**，随后启动 Docker Desktop 即可 `docker compose up -d`。
- 若不便使用 Docker：可安装原生 Windows 版 PostgreSQL，或使用云 Postgres（Neon/Supabase），把连接串填入 `.env` 的 `DATABASE_URL` 即可运行迁移、seed 与 e2e。

## 说明

- **M9 审核**为内嵌能力，对话/创作/生图/看图问答/图生文案在调用模型前后自动执行；无 Key 时用本地关键词（如「暴力/违法」）演示拦截。生图会对模型改写后的 prompt 复审并写入 `media_assets.flagged`。
- **用量计量**：文本按估算 token 写入 `UsageRecord`（`feature=chat|studio|vision`）；图像按张数写入（`feature=image`，token 记 0，成本按模型单价）。`GET /usage` 聚合展示，图像额度独立于 Token 额度。
- **图像 mock 模式**：无 `OPENAI_API_KEY` 时，生图按 prompt 哈希产出**确定性渐变 SVG 占位图**（图中标注描述/尺寸/风格），看图问答与图生文案返回对应体裁的示例文本，可完整演示全链路。
- **媒体存储**：`StorageService` 抽象了 `save / saveBase64 / saveFromUrl / remove / toAbsoluteUrl`，含防路径穿越校验；生产可平滑替换为 S3 兼容对象存储而不改业务代码。
- **停止生成**：单实例内基于 `AbortController` 实现；多实例部署需改为共享状态（Redis）。
- 接入真实模型：在 `.env` 填 `OPENAI_API_KEY`（可选 `OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_IMAGE_MODEL`、`OPENAI_VISION_MODEL`）。
