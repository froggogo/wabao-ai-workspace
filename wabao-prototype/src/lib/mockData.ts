import type { PlanMatrixRow } from "./types";

// 模型清单与会员套餐目录来自前后端共享契约包 @wabao/shared（唯一事实来源），
// 避免与后端漂移。其余业务数据（会话/助手/模板/用量）均来自后端 API。
export {
  MODELS,
  PLAN_CATALOG as PLANS,
  PLAN_ALLOWED_MODELS,
  PLAN_LABELS,
  PLAN_RANK,
} from "@wabao/shared";

// 权益对比矩阵为定价页 UI 专用展示数据（true=✓ / false=✗ / 字符串=具体说明）
export const PLAN_MATRIX: PlanMatrixRow[] = [
  {
    group: "额度与模型",
    label: "每月 Token 配额",
    values: { free: "10 万", plus: "200 万", pro: "2000 万", team: "500 万/人", enterprise: "定制" },
  },
  {
    group: "额度与模型",
    label: "可用模型",
    values: {
      free: "Luna / Terra",
      plus: "+ Sol 旗舰",
      pro: "全部 + Sol 高算力",
      team: "全部模型",
      enterprise: "全部 + 专属容量",
    },
  },
  {
    group: "额度与模型",
    label: "推理强度 reasoning_effort",
    values: { free: "低 / 中", plus: "低 / 中 / 高", pro: "高（最大上下文）", team: "低 / 中 / 高", enterprise: "定制" },
  },
  {
    group: "额度与模型",
    label: "并发与响应优先级",
    values: { free: "标准", plus: "高峰期优先", pro: "最高优先级", team: "高", enterprise: "专属限流" },
  },
  {
    group: "功能能力",
    label: "内容创作模板",
    values: { free: "基础模板", plus: "全部模板", pro: "全部模板", team: "全部模板", enterprise: "全部 + 定制" },
  },
  {
    group: "功能能力",
    label: "结构化输出（JSON Schema）",
    values: { free: false, plus: true, pro: true, team: true, enterprise: true },
  },
  {
    group: "功能能力",
    label: "批量处理 / 后台长任务",
    values: { free: false, plus: false, pro: true, team: true, enterprise: true },
  },
  {
    group: "功能能力",
    label: "新功能抢先体验（图像/语音）",
    values: { free: false, plus: "部分", pro: true, team: "部分", enterprise: true },
  },
  {
    group: "功能能力",
    label: "会话历史保存",
    values: { free: "30 天", plus: "无限", pro: "无限", team: "无限", enterprise: "无限 + 归档" },
  },
  {
    group: "功能能力",
    label: "导出格式",
    values: { free: "Markdown", plus: "Word / PDF", pro: "Word / PDF", team: "Word / PDF", enterprise: "全部 + API" },
  },
  {
    group: "团队与协作",
    label: "协作工作空间",
    values: { free: false, plus: false, pro: false, team: true, enterprise: true },
  },
  {
    group: "团队与协作",
    label: "成员管理与角色权限",
    values: { free: false, plus: false, pro: false, team: true, enterprise: "含 SSO/SCIM" },
  },
  {
    group: "团队与协作",
    label: "共享助手 / 模板 / 知识库",
    values: { free: false, plus: false, pro: false, team: true, enterprise: true },
  },
  {
    group: "安全与支持",
    label: "内容审核与合规",
    values: { free: "基础", plus: "基础", pro: "基础", team: "团队级", enterprise: "等保 / GDPR" },
  },
  {
    group: "安全与支持",
    label: "数据不用于训练",
    values: { free: false, plus: true, pro: true, team: true, enterprise: true },
  },
  {
    group: "安全与支持",
    label: "审计日志 / 数据隔离",
    values: { free: false, plus: false, pro: false, team: "基础", enterprise: true },
  },
  {
    group: "安全与支持",
    label: "SLA 可用性保障",
    values: { free: false, plus: false, pro: false, team: false, enterprise: "99.9%" },
  },
  {
    group: "安全与支持",
    label: "技术支持",
    values: { free: "社区", plus: "邮件", pro: "专属客服", team: "优先支持", enterprise: "专属 CSM" },
  },
];
