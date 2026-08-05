# 蛙宝 AI 工作台（WaBao AI Workspace）

<p>
  <img alt="stack" src="https://img.shields.io/badge/frontend-Next.js%2015%20%2B%20SWR-000000">
  <img alt="stack" src="https://img.shields.io/badge/backend-NestJS%20%2B%20Prisma-e0234e">
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL%2016-336791">
  <img alt="ai" src="https://img.shields.io/badge/AI-OpenAI%20%7C%20mock-412991">
</p>

一个可本地跑通的全栈 AI 工作台：**对话、模板创作、AI 绘图、看图问答**，自带会员配额与 JWT 登录。  
没配 OpenAI Key 也能用——后端会自动走 **mock**，方便先把链路跑通。

| 已实现 | 规划中 |
| --- | --- |
| P1 文本（流式对话 / 创作模板 / 审核 / 账户） | P3 语音 |
| P2 图像（生图 / 变体 / 看图问答 / 图生文案） | P4 深化 |

技术栈：Next.js 15 · NestJS · Prisma · PostgreSQL · pnpm monorepo

---

## 前置条件

启动前请确认本机已安装：

| 工具 | 要求 | 说明 |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | **≥ 20** | 运行前后端 |
| pnpm | 随 Node 启用即可 | 执行一次：`corepack enable` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 已安装并**正在运行** | 用来起 PostgreSQL + Redis |

Windows 首次使用 Docker：先执行 `wsl --install`，重启后再开 Docker Desktop。  
卡在安装步骤时，看这份图文教程：[本地启动与前后端对接指南](./issue/2026-07-22-14_26-本地启动与前后端对接指南.md)。

> OpenAI API Key **不是**前置条件。不填也能跑；要接真实模型时再填。

---

## 三步上手

在项目**根目录**打开终端：

### 1）克隆并进入目录

```bash
git clone https://github.com/froggogo/wabao-ai-workspace.git
cd wabao-ai-workspace
```

### 2）一键初始化

```bash
pnpm setup
```

脚本会自动完成：

1. 从 `.env.example` 生成前后端 `.env`（若不存在）
2. 安装依赖并构建共享包
3. 用 Docker 启动 PostgreSQL + Redis
4. 执行数据库迁移并注入创作模板

若提示 Docker 不可用：先打开 Docker Desktop，再执行：

```bash
pnpm db:up && pnpm db:init
```

### 3）启动前后端（两个终端）

```bash
pnpm dev:api     # 后端 → http://localhost:3001/api/v1
pnpm dev:web     # 前端 → http://localhost:5173
```

浏览器打开 **http://localhost:5173** → 点「去注册」创建账号 → 开始使用。

---

## 接真实大模型（可选）

编辑 `apps/api/.env`：

```env
OPENAI_API_KEY=sk-你的密钥
```

留空则继续走 mock（模拟流式回复与占位图）。  
生产环境请务必改掉 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`。

---

## 数据库怎么用

本项目用 Docker 起本地库，**每人各自一份空库**，不会带他人数据。

| 项 | 默认值 |
| --- | --- |
| 主机端口 | `localhost:5432` |
| 用户 / 密码 / 库名 | `wabao` / `wabao` / `wabao` |
| 连接串 | `postgresql://wabao:wabao@localhost:5432/wabao?schema=public` |
| 建表来源 | `apps/api/prisma/migrations/`（`migrate deploy`） |
| 初始数据 | `seed` 注入平台创作模板 |

常用命令：

```bash
pnpm db:up        # 启动 Postgres + Redis
pnpm db:down      # 停止容器
pnpm db:init      # 迁移 + seed（容器已在跑时）
pnpm db:status    # 查看迁移状态
pnpm db:studio    # 浏览器可视化看表
```

也可用 Neon / 自建 PostgreSQL：改 `apps/api/.env` 里的 `DATABASE_URL`，再执行 `pnpm db:init`。  
更细的库操作说明见：[查看数据库内容的四种方式](./issue/2026-07-22-15_20-查看数据库内容的四种方式.md)。

---

## 根目录常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm setup` | 一键初始化（env + 依赖 + 数据库） |
| `pnpm dev:api` / `pnpm dev:web` | 启动后端 / 前端 |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:init` | 数据库启停与初始化 |
| `pnpm db:studio` | Prisma Studio |
| `pnpm test` / `pnpm test:e2e` | 后端单元 / e2e 测试 |
| `pnpm build` | 构建前后端 |

---

## 项目结构

```
wabao-ai/
├── README.md
├── issue/                 # 产品 / 原型 / 架构文档
├── apps/
│   ├── api/               # NestJS 后端（Prisma + PostgreSQL）
│   │   └── prisma/migrations   # 唯一建表来源
│   └── web/               # Next.js 15 前端（SWR + BFF）
└── packages/
    └── shared/            # 前后端共享契约（@wabao/shared）
```

- 密钥只放各应用 `.env`（已 gitignore，不会上传）；克隆后由 `pnpm setup` 生成。
- 浏览器请求走同源 `/bff`；登录令牌在 httpOnly cookie，前端 JS 读不到。

---

## 文档索引

| 文档 | 说明 |
| --- | --- |
| [本地启动与前后端对接指南](./issue/2026-07-22-14_26-本地启动与前后端对接指南.md) | 从零安装到跑通（含 FAQ） |
| [产品设计文档](./issue/2026-07-21-16_15-产品设计文档.md) | 定位、模块与路线图 |
| [P1 原型与接口设计](./issue/2026-07-21-16_15-P1-文本阶段-原型与接口设计.md) | 文本阶段页面与接口 |
| [P2 原型与接口设计](./issue/2026-07-31-P2-图像阶段-原型与接口设计.md) | 图像阶段页面与接口 |
| [技术架构决策](./issue/2026-07-21-16_15-技术架构决策-前后端与选型.md) | 选型与 monorepo |
| [后端 API README](./apps/api/README.md) | 接口一览、迁移工作流 |
| [查看数据库内容的四种方式](./issue/2026-07-22-15_20-查看数据库内容的四种方式.md) | Prisma Studio / psql / Docker / GUI |

`issue/` 下文档按 `YYYY-MM-DD-HH_MM-<文件名>.md` 命名归档。
