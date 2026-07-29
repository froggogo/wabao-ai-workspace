-- 安全地为 Plan 枚举增加会员套餐值（幂等，不影响其他表/数据）
-- 对应 schema.prisma 的 enum Plan { free plus pro team enterprise }
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'plus';
ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'enterprise';
