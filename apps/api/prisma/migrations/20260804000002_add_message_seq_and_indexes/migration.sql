-- messages 增加单调递增排序键 seq，并把单列索引替换为与实际查询对应的复合索引。
--
-- 注意：本文件为手写，未直接采用 `prisma migrate diff` 的产物，原因有二：
--   1) diff 会把 schema 之外的表（如云厂商的拨测表）判定为多余并生成 DROP TABLE；
--   2) diff 生成的 `ADD COLUMN seq SERIAL` 按物理行顺序赋值，不保证与 created_at 一致。

-- ---------- 1. seq：加列 → 按时间回填 → 绑定序列 ----------

ALTER TABLE "messages" ADD COLUMN "seq" INTEGER;

-- 回填历史数据。以 created_at 为主序、id 为次序，保证同毫秒消息也有确定顺序
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn
  FROM "messages"
)
UPDATE "messages" m
SET "seq" = o.rn
FROM ordered o
WHERE m."id" = o."id";

-- 序列名沿用 Postgres SERIAL 的约定（<table>_<column>_seq），使 Prisma 能识别为 autoincrement
CREATE SEQUENCE "messages_seq_seq" AS INTEGER OWNED BY "messages"."seq";

-- is_called=false：下一次 nextval 直接返回该值本身。
-- 表为空时得到 1，避免 setval(...,0) 越过序列下界报错。
SELECT setval('"messages_seq_seq"', COALESCE((SELECT MAX("seq") FROM "messages"), 0) + 1, false);

ALTER TABLE "messages" ALTER COLUMN "seq" SET DEFAULT nextval('"messages_seq_seq"');
ALTER TABLE "messages" ALTER COLUMN "seq" SET NOT NULL;

-- ---------- 2. 索引：用复合索引替换冗余单列索引 ----------
-- 复合索引的最左前缀已覆盖原单列索引的过滤能力，保留单列索引只会增加写放大。

DROP INDEX "messages_conversation_id_idx";
CREATE INDEX "messages_conversation_id_seq_idx" ON "messages"("conversation_id", "seq");

DROP INDEX "conversations_user_id_idx";
CREATE INDEX "conversations_user_id_pinned_updated_at_idx" ON "conversations"("user_id", "pinned", "updated_at");

DROP INDEX "creations_user_id_idx";
CREATE INDEX "creations_user_id_created_at_idx" ON "creations"("user_id", "created_at");

DROP INDEX "usage_records_user_id_idx";
DROP INDEX "usage_records_created_at_idx";
CREATE INDEX "usage_records_user_id_created_at_idx" ON "usage_records"("user_id", "created_at");

DROP INDEX "moderation_records_user_id_idx";
CREATE INDEX "moderation_records_user_id_created_at_idx" ON "moderation_records"("user_id", "created_at");

DROP INDEX "media_assets_user_id_idx";
DROP INDEX "media_assets_created_at_idx";
CREATE INDEX "media_assets_user_id_created_at_idx" ON "media_assets"("user_id", "created_at");
-- 多模态输入的图片归属校验：WHERE user_id = ? AND url IN (...)
CREATE INDEX "media_assets_user_id_url_idx" ON "media_assets"("user_id", "url");
