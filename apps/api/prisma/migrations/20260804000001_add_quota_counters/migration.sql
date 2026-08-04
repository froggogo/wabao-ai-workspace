-- CreateEnum
CREATE TYPE "QuotaKind" AS ENUM ('tokens', 'images');

-- CreateTable
CREATE TABLE "quota_counters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" "QuotaKind" NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quota_counters_user_id_period_kind_key" ON "quota_counters"("user_id", "period", "kind");

-- AddForeignKey
ALTER TABLE "quota_counters" ADD CONSTRAINT "quota_counters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
