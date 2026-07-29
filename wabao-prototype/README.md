# 蛙宝 AI 工作台 · P1 高保真交互原型

基于 **React 19 + TypeScript + Tailwind CSS v4 + Vite** 的可运行交互原型，覆盖 P1 文本阶段：登录、对话（流式）、创作工作室、助手管理、设置/用量。

> 关联文档：[主 PRD](../issue/2026-07-21-16_15-产品设计文档.md) · [P1 接口设计](../issue/2026-07-21-16_15-P1-文本阶段-原型与接口设计.md) · [技术架构决策](../issue/2026-07-21-16_15-技术架构决策-前后端与选型.md)

## 运行

```bash
pnpm install
pnpm dev      # 开发：http://localhost:5173
pnpm build    # 类型检查 + 生产构建
pnpm preview  # 预览构建产物
```

> 登录页已预填测试账号，直接点「登录」即可进入。

## 已实现的交互（高保真）

- **登录/注册**：品牌页 + 表单校验，登录后进入工作台。
- **对话（核心）**：多会话管理（新建/搜索/重命名/置顶/删除）、**模拟流式输出**（打字机 + 光标）、停止生成、重新生成、复制、点赞/点踩、Markdown/代码渲染、模型切换（Sol/Terra/Luna）、人设切换、**输入审核拦截**演示（输入含“暴力/违法/血腥”会被拦截）。
- **创作工作室**：模板库（分类筛选）、根据 `input_schema` 动态渲染表单、流式生成、结构化输出模板（JSON）、复制/重生成、历史记录。
- **助手管理**：人设 CRUD（头像/名称/system prompt/默认模型）。
- **会员升级**：定价页（免费/Plus/Pro/团队/企业）、月付/年付切换、套餐卡片 + 权益详细对比表、升级确认弹窗（参考 ChatGPT 价格区间本地化，原型为前端模拟不扣费）。
- **设置**：用量配额进度条（超 80% 预警）+ 用量明细表、当前套餐 + 升级入口、个人信息。

## 工程结构

```
src/
├── main.tsx                # 入口
├── App.tsx                 # 路由 + 登录守卫
├── index.css               # Tailwind v4 + 主题变量
├── lib/
│   ├── types.ts            # 全局类型（对应后端 DTO，可迁移为共享契约包）
│   ├── api.ts              # REST + SSE 客户端（对接真实后端）
│   └── mockData.ts         # 静态展示目录（模型 / 会员套餐 / 权益对比）
├── store/appStore.ts       # Zustand 全局状态
├── components/
│   ├── Markdown.tsx        # 轻量 Markdown 渲染
│   └── layout/AppLayout.tsx
└── pages/                  # Login / Chat / Studio / StudioTemplate / Assistants / Pricing / Settings
```

## 说明

- 本原型已**对接真实后端**（NestJS），对话/创作走 `POST /conversations/:id/messages`、`POST /creations` 的 SSE 流式；会员升级走 `POST /billing/subscriptions`。
- 后端未配置 `OPENAI_API_KEY` 时自动进入 mock 模式（返回模拟流式内容），链路照样跑通。
- `lib/mockData.ts` 仅保留**静态展示目录**（模型列表、会员套餐与权益对比）；其余业务数据均来自后端 API。
- `lib/types.ts` 的类型对应后端 DTO，未来可抽到 monorepo 的 `packages/shared` 前后端共享。
