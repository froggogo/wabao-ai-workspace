import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors';
import { BillingService } from './billing.service';
import { CreateOrderDto, PaymentWebhookDto, SubscribeDto } from './dto/billing.dto';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  /** 套餐目录（公开，无需登录即可查看定价） */
  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Get('billing/subscription')
  @UseGuards(JwtAuthGuard)
  subscription(@CurrentUser() user: CurrentUserData) {
    return this.billing.getSubscription(user.id);
  }

  @Post('billing/subscriptions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  subscribe(@CurrentUser() user: CurrentUserData, @Body() dto: SubscribeDto) {
    return this.billing.subscribe(user.id, dto.plan, dto.cycle);
  }

  /** 取消订阅：当期照常可用，周期末回落免费版 */
  @Delete('billing/subscription')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: CurrentUserData) {
    return this.billing.cancel(user.id);
  }

  /** 撤销取消（周期结束前可反悔） */
  @Post('billing/subscription/resume')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: CurrentUserData) {
    return this.billing.resume(user.id);
  }

  // ---------- 订单 ----------

  @Post('billing/orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  createOrder(@CurrentUser() user: CurrentUserData, @Body() dto: CreateOrderDto) {
    return this.billing.createOrder(user.id, dto.plan, dto.cycle, dto.provider);
  }

  @Get('billing/orders')
  @UseGuards(JwtAuthGuard)
  listOrders(@CurrentUser() user: CurrentUserData) {
    return this.billing.listOrders(user.id);
  }

  @Get('billing/orders/:orderNo')
  @UseGuards(JwtAuthGuard)
  getOrder(@CurrentUser() user: CurrentUserData, @Param('orderNo') orderNo: string) {
    return this.billing.getOrder(user.id, orderNo);
  }

  @Delete('billing/orders/:orderNo')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  cancelOrder(@CurrentUser() user: CurrentUserData, @Param('orderNo') orderNo: string) {
    return this.billing.cancelOrder(user.id, orderNo);
  }

  /** 仅 PAYMENT_PROVIDER=mock 可用：模拟支付成功 */
  @Post('billing/orders/:orderNo/mock-pay')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  mockPay(@CurrentUser() user: CurrentUserData, @Param('orderNo') orderNo: string) {
    return this.billing.mockPayOrder(user.id, orderNo);
  }

  /**
   * 支付渠道回调。用共享密钥验签（`PAYMENT_WEBHOOK_SECRET`）；
   * mock 渠道在未配置密钥时放行，便于本地联调。
   */
  @Post('billing/webhooks/:provider')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Param('provider') provider: string,
    @Body() dto: PaymentWebhookDto,
    @Headers('x-wabao-signature') signature?: string,
  ) {
    this.assertWebhookSignature(provider, signature);
    return this.billing.handleWebhook(provider, dto);
  }

  private assertWebhookSignature(provider: string, signature?: string): void {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET') ?? '';
    const paymentProvider = (this.config.get<string>('PAYMENT_PROVIDER') ?? 'mock').toLowerCase();

    // mock 且未配密钥：本地开发放行
    if (!secret && (provider === 'mock' || paymentProvider === 'mock')) {
      return;
    }
    if (!secret) {
      throw new AppException('forbidden', '未配置支付回调密钥');
    }
    if (!signature) {
      throw new AppException('unauthorized', '缺少支付回调签名');
    }
    const expected = Buffer.from(secret);
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AppException('unauthorized', '支付回调签名无效');
    }
  }
}
