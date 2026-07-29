// 会员套餐配置来自前后端共享契约包（唯一事实来源），后端在此薄封装并透出。
// PlanCatalogEntry.id 为 PlanId 字符串，与 Prisma 的 Plan 枚举取值一致，可直接互用。
export {
  PLAN_CATALOG as PLANS,
  PLAN_MAP,
  isModelAllowed,
  quotaForPlan,
} from '@wabao/shared';
export type { PlanCatalogEntry as PlanConfig } from '@wabao/shared';
