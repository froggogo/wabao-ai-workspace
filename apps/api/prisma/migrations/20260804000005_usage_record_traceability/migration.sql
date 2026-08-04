-- UsageRecord 溯源字段 + 幂等键
-- 手写迁移：避免 prisma migrate diff 对云厂商拨测表生成 DROP TABLE。

ALTER TABLE "usage_records" ADD COLUMN "message_id" TEXT;
ALTER TABLE "usage_records" ADD COLUMN "creation_id" TEXT;
ALTER TABLE "usage_records" ADD COLUMN "media_asset_id" TEXT;
ALTER TABLE "usage_records" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "usage_records_idempotency_key_key" ON "usage_records"("idempotency_key");
CREATE INDEX "usage_records_message_id_idx" ON "usage_records"("message_id");
CREATE INDEX "usage_records_creation_id_idx" ON "usage_records"("creation_id");
CREATE INDEX "usage_records_media_asset_id_idx" ON "usage_records"("media_asset_id");
