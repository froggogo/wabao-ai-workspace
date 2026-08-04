import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingCycle, Plan } from '@prisma/client';

export class SubscribeDto {
  @IsEnum(Plan, { message: 'plan 非法' })
  plan!: Plan;

  @IsOptional()
  @IsEnum(BillingCycle, { message: 'cycle 仅支持 monthly / yearly' })
  cycle?: BillingCycle;
}

export class CreateOrderDto {
  @IsEnum(Plan, { message: 'plan 非法' })
  plan!: Plan;

  @IsOptional()
  @IsEnum(BillingCycle, { message: 'cycle 仅支持 monthly / yearly' })
  cycle?: BillingCycle;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;
}

/** 支付渠道 Webhook 通用载荷（mock / 真实渠道共用字段） */
export class PaymentWebhookDto {
  @IsString()
  @MaxLength(64)
  order_no!: string;

  @IsIn(['paid', 'failed', 'refunded'])
  event!: 'paid' | 'failed' | 'refunded';

  @IsOptional()
  @IsString()
  @MaxLength(128)
  provider_txn_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}
