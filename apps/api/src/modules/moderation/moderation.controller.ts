import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ModerationRefType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ModerationService } from './moderation.service';

/**
 * M9 审核记录只读接口。P1 暂无角色系统，作用域限定为当前用户自己的审核记录。
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('moderation-records')
  list(
    @CurrentUser() user: CurrentUserData,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('flagged') flagged?: string,
    @Query('ref_type') refType?: string,
  ) {
    return this.moderation.listRecords(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      flagged: flagged === undefined ? undefined : flagged === 'true',
      refType:
        refType === 'input' || refType === 'output'
          ? (refType as ModerationRefType)
          : undefined,
    });
  }
}
