import { Body, Controller, Get, Patch, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/users.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users/me')
  me(@CurrentUser() user: CurrentUserData) {
    return this.users.me(user.id);
  }

  @Patch('users/me')
  update(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Get('usage')
  async usage(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
    @Query('period') period?: string,
  ) {
    const data = await this.users.usage(user.id, period);
    res.setHeader('X-Quota-Remaining', String(data.remaining_tokens));
    return data;
  }
}
