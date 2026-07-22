import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors';
import { initSse, SseEvent, writeSse } from '../../common/sse';
import { CreationsService } from './creations.service';
import { CreateCreationDto } from './dto/creations.dto';

@Controller()
export class CreationsController {
  constructor(private readonly creations: CreationsService) {}

  // 模板为平台级公开资源，无需鉴权
  @Get('templates')
  templates(@Query('category') category?: string) {
    return this.creations.listTemplates(category);
  }

  @Get('templates/:id')
  template(@Param('id') id: string) {
    return this.creations.getTemplate(id);
  }

  @Get('creations')
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser() user: CurrentUserData) {
    return this.creations.listCreations(user.id);
  }

  @Get('creations/:id')
  @UseGuards(JwtAuthGuard)
  detail(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.creations.getCreation(user.id, id);
  }

  @Delete('creations/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.creations.removeCreation(user.id, id);
    return { success: true };
  }

  @Post('creations')
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCreationDto,
    @Res() res: Response,
  ): Promise<void> {
    const gen = this.creations.create(user.id, dto);
    await this.pipe(gen, dto.stream !== false, res);
  }

  private async pipe(
    gen: AsyncGenerator<SseEvent>,
    stream: boolean,
    res: Response,
  ): Promise<void> {
    if (stream) {
      let started = false;
      try {
        for await (const evt of gen) {
          if (!started) {
            initSse(res);
            started = true;
          }
          writeSse(res, evt);
        }
      } catch (err) {
        if (!started) throw err;
        writeSse(res, {
          event: 'error',
          data: { code: 'internal_error', message: (err as Error).message },
        });
      } finally {
        if (started) res.end();
      }
      return;
    }

    let creationId = '';
    let output = '';
    let outputJson: unknown = null;
    let usage: unknown = null;
    for await (const evt of gen) {
      const data = evt.data as Record<string, unknown>;
      switch (evt.event) {
        case 'message.start':
          creationId = data.creation_id as string;
          break;
        case 'message.delta':
          output += (data.text as string) ?? '';
          break;
        case 'message.done':
          outputJson = data.output_json ?? null;
          usage = data.usage;
          break;
        case 'error':
          throw new AppException(
            (data.code as 'content_flagged' | 'upstream_error') ?? 'internal_error',
            (data.message as string) ?? '生成失败',
            data.details,
          );
      }
    }
    res.status(HttpStatus.OK).json({
      data: { id: creationId, output, output_json: outputJson, usage },
    });
  }
}
