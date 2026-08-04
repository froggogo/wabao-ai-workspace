import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionService } from './subscription.service';
import { OrderService } from './order.service';

// 订阅是配额计量的周期来源，用量与图像模块都依赖它，故整体设为全局
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, SubscriptionService, OrderService],
  exports: [BillingService, SubscriptionService, OrderService],
})
export class BillingModule {}
