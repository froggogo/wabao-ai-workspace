import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { Plan } from '@prisma/client';

export class SubscribeDto {
  @IsEnum(Plan, { message: 'plan 非法' })
  plan!: Plan;

  @IsOptional()
  @IsIn(['monthly', 'yearly'], { message: 'cycle 仅支持 monthly / yearly' })
  cycle?: 'monthly' | 'yearly';
}
