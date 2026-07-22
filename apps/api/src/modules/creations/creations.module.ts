import { Module } from '@nestjs/common';
import { CreationsController } from './creations.controller';
import { CreationsService } from './creations.service';

@Module({
  controllers: [CreationsController],
  providers: [CreationsService],
  exports: [CreationsService],
})
export class CreationsModule {}
