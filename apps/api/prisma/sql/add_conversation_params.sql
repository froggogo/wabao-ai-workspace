-- 安全地为 conversations 增加 P1 增强字段（幂等，不影响其他表）
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7;
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "reasoning_effort" TEXT NOT NULL DEFAULT 'medium';
