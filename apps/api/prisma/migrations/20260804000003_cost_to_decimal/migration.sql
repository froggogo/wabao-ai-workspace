-- 金额字段由 double precision 改为 numeric(12,6)。
-- 浮点数无法精确表示十进制小数，逐笔累加会产生漂移，用量报表与对账会对不上。
--
-- 手写而非直接采用 `prisma migrate diff` 的产物：diff 会把 schema 之外的表
-- （云厂商的拨测表）判定为多余并生成 DROP TABLE，此处必须剔除。
--
-- 现有数据由 Postgres 隐式转换（double -> numeric，按 6 位小数舍入）。
-- 当前各表金额均由 estimateCost 产出，精度不超过 4 位小数，转换无损。

ALTER TABLE "messages" ALTER COLUMN "cost" SET DATA TYPE DECIMAL(12,6);

ALTER TABLE "creations" ALTER COLUMN "cost" SET DATA TYPE DECIMAL(12,6);

ALTER TABLE "usage_records" ALTER COLUMN "cost" SET DATA TYPE DECIMAL(12,6);

ALTER TABLE "media_assets" ALTER COLUMN "cost" SET DATA TYPE DECIMAL(12,6);
