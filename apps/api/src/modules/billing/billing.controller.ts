import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto/billing.dto';

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
}
