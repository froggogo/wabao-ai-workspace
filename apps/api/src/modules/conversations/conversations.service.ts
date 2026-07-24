import { Injectable } from '@nestjs/common';
import { Conversation, Message } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { SseEvent } from '../../common/sse';
import { AbortRegistry } from '../../common/abort-registry.service';
import { AiService, ReasoningEffort } from '../../ai/ai.service';
import { RouterService } from '../../ai/router.service';
import { PromptService, ChatTurn } from '../../ai/prompt.service';
import { estimateCost, estimateTokens, ModelId } from '../../ai/models';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import {
  CreateConversationDto,
  FeedbackDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversations.dto';

const HISTORY_LIMIT = 20;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly router: RouterService,
    private readonly prompt: PromptService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
    private readonly abortRegistry: AbortRegistry,
  ) {}

  // ---------- 会话 CRUD ----------

  async list(userId: string, q?: string) {
    const items = await this.prisma.conversation.findMany({
      where: {
        userId,
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    });
    return items.map((c) => this.toConversationDto(c));
  }

  async create(userId: string, dto: CreateConversationDto) {
    if (dto.assistant_id) {
      await this.assertAssistant(userId, dto.assistant_id);
    }
    const c = await this.prisma.conversation.create({
      data: {
        userId,
        title: dto.title?.trim() || '新会话',
        model: dto.model ?? 'gpt-5.6-terra',
        assistantId: dto.assistant_id ?? null,
      },
    });
    return this.toConversationDto(c);
  }

  async get(userId: string, id: string) {
    const c = await this.findOwned(userId, id);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...this.toConversationDto(c), messages: messages.map((m) => this.toMessageDto(m)) };
  }

  async update(userId: string, id: string, dto: UpdateConversationDto) {
    await this.findOwned(userId, id);
    if (dto.assistant_id) {
      await this.assertAssistant(userId, dto.assistant_id);
    }
    const c = await this.prisma.conversation.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.assistant_id !== undefined ? { assistantId: dto.assistant_id } : {}),
        ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
        ...(dto.reasoning_effort !== undefined ? { reasoningEffort: dto.reasoning_effort } : {}),
      },
    });
    return this.toConversationDto(c);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.conversation.delete({ where: { id } });
  }

  async listMessages(userId: string, id: string, page = 1, pageSize = 20) {
    await this.findOwned(userId, id);
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
      }),
      this.prisma.message.count({ where: { conversationId: id } }),
    ]);
    return {
      data: items.map((m) => this.toMessageDto(m)),
      pagination: { page, page_size: pageSize, total },
    };
  }

  // ---------- 消息与流式对话（核心） ----------

  /** 发送消息并流式生成回复；yield SSE 事件（stream/非流式共用此生成器） */
  async *sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<SseEvent> {
    const conversation = await this.findOwned(userId, conversationId);
    const model = this.router.resolve(dto.model ?? conversation.model);

    // ⓪ 配额校验（超额则抛 429，在首个 SSE 事件前，返回标准 JSON 错误）
    await this.usage.assertQuota(userId);

    // ① 输入审核
    const inMod = await this.moderation.check(dto.content, 'input', { userId });

    // 保存用户消息（即便被拦截也保留，标记 flagged）
    const userMsg = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.content,
        flagged: inMod.flagged,
      },
    });
    await this.touchConversation(conversation, dto.content);

    if (inMod.action === 'block') {
      yield {
        event: 'error',
        data: {
          code: 'content_flagged',
          message: '内容不符合规范，已被拦截',
          details: { categories: inMod.categories },
        },
      };
      return;
    }

    const turns = await this.buildContext(conversation, dto.content, userMsg.id);
    yield* this.streamAssistant({ userId, conversation, model, contextTurns: turns });
  }

  /** 重新生成指定 AI 回复 */
  async *regenerate(userId: string, messageId: string): AsyncGenerator<SseEvent> {
    const target = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!target) {
      throw new AppException('not_found', '消息不存在');
    }
    const conversation = await this.findOwned(userId, target.conversationId);
    if (target.role !== 'assistant') {
      throw new AppException('invalid_request', '仅能重新生成 AI 回复');
    }
    await this.usage.assertQuota(userId);
    const userMsg = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id, role: 'user', createdAt: { lt: target.createdAt } },
      orderBy: { createdAt: 'desc' },
    });
    if (!userMsg) {
      throw new AppException('invalid_request', '找不到对应的用户消息');
    }
    const model = this.router.resolve(conversation.model);
    const turns = await this.buildContext(conversation, userMsg.content, userMsg.id);
    yield* this.streamAssistant({
      userId,
      conversation,
      model,
      contextTurns: turns,
      parentId: target.id,
    });
  }

  /** 停止生成（进行中的任务由 AbortController 中断） */
  async stop(userId: string, messageId: string): Promise<{ stopped: boolean }> {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) {
      throw new AppException('not_found', '消息不存在');
    }
    await this.findOwned(userId, msg.conversationId);
    return { stopped: this.abortRegistry.abort(messageId) };
  }

  async feedback(userId: string, messageId: string, dto: FeedbackDto) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) {
      throw new AppException('not_found', '消息不存在');
    }
    await this.findOwned(userId, msg.conversationId);
    const fb = await this.prisma.feedback.create({
      data: { messageId, rating: dto.rating, comment: dto.comment },
    });
    return { id: fb.id, message_id: messageId, rating: fb.rating, comment: fb.comment };
  }

  // ---------- 内部：流式生成核心 ----------

  private async *streamAssistant(params: {
    userId: string;
    conversation: Conversation;
    model: ModelId;
    contextTurns: ChatTurn[];
    parentId?: string;
  }): AsyncGenerator<SseEvent> {
    const { userId, conversation, model, contextTurns, parentId } = params;

    const assistantMsg = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        model,
        parentId: parentId ?? null,
      },
    });
    const controller = this.abortRegistry.create(assistantMsg.id);

    yield { event: 'message.start', data: { message_id: assistantMsg.id, role: 'assistant' } };

    let acc = '';
    let finishReason = 'stop';
    try {
      const genOptions = {
        temperature: conversation.temperature,
        reasoningEffort: conversation.reasoningEffort as ReasoningEffort,
      };
      for await (const delta of this.ai.stream(
        contextTurns,
        model,
        controller.signal,
        genOptions,
      )) {
        acc += delta;
        yield { event: 'message.delta', data: { text: delta } };
      }
      if (controller.signal.aborted) {
        finishReason = 'stopped';
      }
    } catch (err) {
      this.abortRegistry.clear(assistantMsg.id);
      await this.finalizeMessage(assistantMsg.id, acc, model, contextTurns, 'error', false);
      yield {
        event: 'error',
        data: { code: 'upstream_error', message: `模型服务异常：${(err as Error).message}` },
      };
      return;
    }
    this.abortRegistry.clear(assistantMsg.id);

    // ② 输出审核
    const outMod = await this.moderation.check(acc, 'output', {
      userId,
      refId: assistantMsg.id,
    });
    const flagged = outMod.action === 'block';

    const { inputTokens, outputTokens } = await this.finalizeMessage(
      assistantMsg.id,
      acc,
      model,
      contextTurns,
      finishReason,
      flagged,
    );

    await this.usage.record({ userId, feature: 'chat', model, inputTokens, outputTokens });

    yield {
      event: 'message.done',
      data: {
        finish_reason: flagged ? 'content_filter' : finishReason,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    };
  }

  private async finalizeMessage(
    messageId: string,
    content: string,
    model: ModelId,
    contextTurns: ChatTurn[],
    finishReason: string,
    flagged: boolean,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    const inputTokens = contextTurns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    const outputTokens = estimateTokens(content);
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        inputTokens,
        outputTokens,
        cost: estimateCost(model, inputTokens, outputTokens),
        finishReason,
        flagged,
      },
    });
    return { inputTokens, outputTokens };
  }

  private async buildContext(
    conversation: Conversation,
    userContent: string,
    excludeMessageId: string,
  ): Promise<ChatTurn[]> {
    const assistant = conversation.assistantId
      ? await this.prisma.assistant.findUnique({ where: { id: conversation.assistantId } })
      : null;

    const historyRows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        id: { not: excludeMessageId },
        content: { not: '' },
      },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
    });

    const history = historyRows.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    return this.prompt.buildChatMessages({
      systemPrompt: assistant?.systemPrompt,
      history,
      userContent,
    });
  }

  private async touchConversation(conversation: Conversation, firstUserContent: string) {
    const count = await this.prisma.message.count({
      where: { conversationId: conversation.id },
    });
    const isFirst = count <= 1 && conversation.title === '新会话';
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        ...(isFirst ? { title: firstUserContent.slice(0, 18) } : {}),
      },
    });
  }

  // ---------- 辅助 ----------

  private async findOwned(userId: string, id: string): Promise<Conversation> {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c) {
      throw new AppException('not_found', '会话不存在');
    }
    if (c.userId !== userId) {
      throw new AppException('forbidden', '无权访问该会话');
    }
    return c;
  }

  private async assertAssistant(userId: string, assistantId: string): Promise<void> {
    const a = await this.prisma.assistant.findUnique({ where: { id: assistantId } });
    if (!a || a.userId !== userId) {
      throw new AppException('invalid_request', '指定的助手不存在');
    }
  }

  private toConversationDto(c: Conversation) {
    return {
      id: c.id,
      title: c.title,
      model: c.model,
      assistant_id: c.assistantId,
      pinned: c.pinned,
      temperature: c.temperature,
      reasoning_effort: c.reasoningEffort,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    };
  }

  private toMessageDto(m: Message) {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      flagged: m.flagged,
      finish_reason: m.finishReason,
      usage: { input_tokens: m.inputTokens, output_tokens: m.outputTokens },
      parent_id: m.parentId,
      created_at: m.createdAt,
    };
  }
}
