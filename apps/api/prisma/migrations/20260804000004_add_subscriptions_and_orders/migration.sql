-- 订阅与订单：把「套餐权益」从 users 的两个冗余列升级为有周期、有凭据的模型。
--
-- 手写而非直接采用 `prisma migrate diff` 的产物，改动有三：
--   1) 剔除 diff 对云厂商拨测表生成的 DROP TABLE；
--   2) 增加部分唯一索引，保证一个用户最多一条 active 订阅（Prisma schema 无法表达）；
--   3) 为存量用户回填订阅，否则老用户没有 active 订阅会直接失去全部权益。

-- ---------- 1. 枚举 ----------

CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'expired');
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'failed', 'canceled', 'refunded');

-- ---------- 2. 建表 ----------

CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'monthly',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "quota_tokens" INTEGER NOT NULL,
    "monthly_images" INTEGER NOT NULL,
    "pending_plan" "Plan",
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "plan" "Plan" NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "provider_txn_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- ---------- 3. 索引与外键 ----------

CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- 一个用户最多一条生效中的订阅。这是配额计算的正确性前提：
-- 存在两条 active 订阅时，「当前套餐」将不确定。
-- 部分索引无法在 Prisma schema 中声明，因此后续 migrate diff 会持续把它
-- 报告为「多余索引」，属已知差异，不要据此生成 DROP。
CREATE UNIQUE INDEX "subscriptions_user_id_active_key"
  ON "subscriptions"("user_id") WHERE "status" = 'active';

CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");
-- 渠道交易号唯一：支付回调重复送达时，插入冲突即天然幂等
CREATE UNIQUE INDEX "orders_provider_txn_id_key" ON "orders"("provider_txn_id");
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- 4. 存量用户回填 ----------
-- 权益快照取自 packages/shared 的套餐目录（PLAN_CATALOG / PLAN_IMAGE_LIMITS）。
-- 两处数值必须一致；后续调价只影响新订阅，存量订阅沿用快照。
INSERT INTO "subscriptions" (
  "id", "user_id", "plan", "cycle", "status",
  "current_period_start", "current_period_end", "expires_at",
  "quota_tokens", "monthly_images", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  u."id",
  u."plan",
  'monthly',
  'active',
  now(),
  now() + interval '30 days',
  -- 免费版永不过期；存量付费用户先给一个完整周期，后续由续费流程接管
  CASE WHEN u."plan" = 'free' THEN NULL ELSE now() + interval '30 days' END,
  CASE u."plan"
    WHEN 'free'       THEN 100000
    WHEN 'plus'       THEN 2000000
    WHEN 'pro'        THEN 20000000
    WHEN 'team'       THEN 5000000
    WHEN 'enterprise' THEN 0
  END,
  CASE u."plan"
    WHEN 'free'       THEN 20
    WHEN 'plus'       THEN 500
    WHEN 'pro'        THEN 5000
    WHEN 'team'       THEN 2000
    WHEN 'enterprise' THEN 0
  END,
  now(),
  now()
FROM "users" u;
