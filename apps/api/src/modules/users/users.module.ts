import { Global, Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsageService } from './usage.service';

@Global()
@Module({
  controllers: [UsersController],
  providers: [UsersService, UsageService],
  exports: [UsersService, UsageService],
})
export class UsersModule {}
