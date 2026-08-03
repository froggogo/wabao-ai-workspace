-- P2 图像与多模态（M5）：媒体资产表 + 用量枚举扩展 + 消息附件字段
-- 全部幂等，可重复执行；用于不便跑 prisma migrate 的环境（如共享数据库）。

-- 1) 用量特征枚举新增 image / vision
ALTER TYPE "UsageFeature" ADD VALUE IF NOT EXISTS 'image';
ALTER TYPE "UsageFeature" ADD VALUE IF NOT EXISTS 'vision';

-- 2) 媒体类型与来源枚举
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaType') THEN
    CREATE TYPE "MediaType" AS ENUM ('image', 'video');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaSource') THEN
    CREATE TYPE "MediaSource" AS ENUM ('generation', 'variation', 'upload');
  END IF;
END
$$;

-- 3) 消息附件（多模态输入：图片 URL 数组）
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "attachments" JSONB;

-- 4) 媒体资产表
CREATE TABLE IF NOT EXISTS "media_assets" (
  "id"             TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "type"           "MediaType" NOT NULL DEFAULT 'image',
  "source"         "MediaSource" NOT NULL DEFAULT 'generation',
  "url"            TEXT NOT NULL,
  "prompt"         TEXT NOT NULL DEFAULT '',
  "revised_prompt" TEXT,
  "model"          TEXT NOT NULL DEFAULT '',
  "size"           TEXT NOT NULL DEFAULT '',
  "style"          TEXT NOT NULL DEFAULT '',
  "width"          INTEGER NOT NULL DEFAULT 0,
  "height"         INTEGER NOT NULL DEFAULT 0,
  "bytes"          INTEGER NOT NULL DEFAULT 0,
  "mime_type"      TEXT NOT NULL DEFAULT 'image/png',
  "source_id"      TEXT,
  "flagged"        BOOLEAN NOT NULL DEFAULT false,
  "cost"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "media_assets_user_id_idx" ON "media_assets" ("user_id");
CREATE INDEX IF NOT EXISTS "media_assets_created_at_idx" ON "media_assets" ("created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_user_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_source_id_fkey'
  ) THEN
    ALTER TABLE "media_assets"
      ADD CONSTRAINT "media_assets_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "media_assets" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
