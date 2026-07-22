import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors';
import { initSse, SseEvent, writeSse } from '../../common/sse';
import { AbortRegistry } from '../../common/abort-registry.service';
import { ConversationsService } from './conversations.service';
import {
  CreateConversationDto,
  FeedbackDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversations.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly abortRegistry: AbortRegistry,
  ) {}

  @Get('conversations')
  list(@CurrentUser() user: CurrentUserData, @Query('q') q?: string) {
    return this.conversations.list(user.id, q);
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.id, dto);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.conversations.get(user.id, id);
  }

  @Patch('conversations/:id')
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.conversations.update(user.id, id, dto);
  }

  @Delete('conversations/:id')
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.conversations.remove(user.id, id);
    return { success: true };
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    return this.conversations.listMessages(
      user.id,
      id,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @Post('conversations/:id/messages')
  async send(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const gen = this.conversations.sendMessage(user.id, id, dto);
    await this.pipe(gen, dto.stream !== false, req, res);
  }

  @Post('messages/:id/regenerate')
  async regenerate(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body('stream') stream: boolean | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const gen = this.conversations.regenerate(user.id, id);
    await this.pipe(gen, stream !== false, req, res);
  }

  @Post('messages/:id/stop')
  @HttpCode(HttpStatus.OK)
  stop(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.conversations.stop(user.id, id);
  }

  @Post('messages/:id/feedback')
  @HttpCode(HttpStatus.OK)
  feedback(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: FeedbackDto,
  ) {
    return this.conversations.feedback(user.id, id, dto);
  }

  /**
   * 消费生成器：stream=true 走 SSE；否则聚合为一次性 JSON。
   * SSE 期间客户端断开则中断生成。
   */
  private async pipe(
    gen: AsyncGenerator<SseEvent>,
    stream: boolean,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (stream) {
      let started = false;
      let messageId: string | null = null;
      const onClose = () => {
        if (messageId) this.abortRegistry.abort(messageId);
      };
      try {
        for await (const evt of gen) {
          if (!started) {
            // 首个事件到达才发送 SSE 头，保证前置校验错误仍能走标准 JSON 错误
            initSse(res);
            req.on('close', onClose);
            started = true;
          }
          if (evt.event === 'message.start') {
            messageId = (evt.data as { message_id: string }).message_id;
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
        if (started) {
          req.off('close', onClose);
          res.end();
        }
      }
      return;
    }

    // 非流式：聚合
    let messageId = '';
    let content = '';
    let usage: unknown = null;
    let finishReason: string | null = null;
    for await (const evt of gen) {
      const data = evt.data as Record<string, unknown>;
      switch (evt.event) {
        case 'message.start':
          messageId = data.message_id as string;
          break;
        case 'message.delta':
          content += (data.text as string) ?? '';
          break;
        case 'message.done':
          usage = data.usage;
          finishReason = data.finish_reason as string;
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
      data: {
        message: {
          id: messageId,
          role: 'assistant',
          content,
          finish_reason: finishReason,
          usage,
        },
      },
    });
  }
}
