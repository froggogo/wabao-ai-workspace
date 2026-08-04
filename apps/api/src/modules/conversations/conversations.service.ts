import { Injectable } from '@nestjs/common';
import { Conversation, Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { SseEvent } from '../../common/sse';
import { AbortRegistry } from '../../common/abort-registry.service';
import { AiService, ReasoningEffort, TokenUsage } from '../../ai/ai.service';
import { RouterService } from '../../ai/router.service';
import { PromptService, ChatTurn } from '../../ai/prompt.service';
import { estimateCost, estimateTokens, ModelId } from '../../ai/models';
import { ModerationService } from '../moderation/moderation.service';
import { UsageService } from '../users/usage.service';
import { BillingService } from '../billing/billing.service';
import {
  CreateConversationDto,
  FeedbackDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversations.dto';

const HISTORY_LIMIT = 20;

/**
 * 调模型前预留额度时，对「本次回复输出量」的保守估计。
 * 真实用量在生成结束后由 settleTokens 修正，这里只需覆盖绝大多数回复的长度，
 * 使并发请求无法凭「都还没记账」同时挤过配额校验。
 */
const RESERVED_OUTPUT_TOKENS = 2000;

/** 输出审核命中拦截时，用于替换违规内容的脱敏提示（落库 + 前端展示） */
const OUTPUT_BLOCKED_NOTICE = '⚠️ 该回复包含不符合规范的内容，已被拦截。';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly router: RouterService,
    private readonly prompt: PromptService,
    private readonly moderation: ModerationService,
    private readonly usage: UsageService,
    private readonly billing: BillingService,
    private readonly abortRegistry: AbortRegistry,
  ) {}

  // ---------- 会话 CRUD ----------

  async list(userId: string, q?: string, page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where: Prisma.ConversationWhereInput = {
      userId,
      ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
        skip: (safePage - 1) * safeSize,
        take: safeSize,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return {
      data: items.map((c) => this.toConversationDto(c)),
      pagination: { page: safePage, page_size: safeSize, total },
    };
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
      orderBy: { seq: 'asc' },
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
        orderBy: { seq: 'asc' },
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

    // ⓪ 配额校验（超额则抛 429）+ 模型权限校验（套餐不含则抛 403），
    //    均在首个 SSE 事件前，返回标准 JSON 错误
    await this.usage.assertQuota(userId);
    await this.billing.assertModelAllowed(userId, model);

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

    const turns = await this.buildContext(conversation, dto.content, {
      excludeMessageId: userMsg.id,
    });
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
    await this.billing.assertModelAllowed(userId, this.router.resolve(conversation.model));
    const userMsg = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id, role: 'user', seq: { lt: target.seq } },
      orderBy: { seq: 'desc' },
    });
    if (!userMsg) {
      throw new AppException('invalid_request', '找不到对应的用户消息');
    }
    const model = this.router.resolve(conversation.model);
    // 截断到这条用户消息之前：目标回复本身、以及它之后的消息都不进入上下文
    const turns = await this.buildContext(conversation, userMsg.content, {
      beforeSeq: userMsg.seq,
    });
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

    // 原子预留额度。必须早于任何副作用与首个 SSE 事件：此时响应头尚未发出，
    // 超额可以走标准 JSON 错误返回 429。
    const estimatedInput = contextTurns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    const reserved = estimatedInput + RESERVED_OUTPUT_TOKENS;
    await this.usage.reserveTokens(userId, reserved);
    let settled = false;
    const settle = async (actual: number) => {
      if (settled) return;
      settled = true;
      await this.usage.settleTokens(userId, reserved, actual);
    };

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
    let realUsage: TokenUsage | null = null;
    // 客户端中途断开时消费方会丢弃生成器，触发 finally；此时按已产出的内容结算，
    // 把剩余预留归还，避免额度被断开的请求长期占用。
    try {
      try {
        const genOptions = {
          temperature: conversation.temperature,
          reasoningEffort: conversation.reasoningEffort as ReasoningEffort,
          onUsage: (u: TokenUsage) => {
            realUsage = u;
          },
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
        const partial = await this.finalizeMessage(
          assistantMsg.id,
          acc,
          model,
          contextTurns,
          'error',
          false,
        );
        // 上游失败也要归还未消耗的预留，否则失败请求会持续侵蚀用户额度
        await settle(partial.inputTokens + partial.outputTokens);
        yield {
          event: 'error',
          data: { code: 'upstream_error', message: `模型服务异常：${(err as Error).message}` },
        };
        return;
      }
      this.abortRegistry.clear(assistantMsg.id);

      // ② 输出审核：命中拦截则用脱敏提示替换违规内容（落库与前端展示），
      //    但计费仍按模型实际生成的内容(acc)计量。
      const outMod = await this.moderation.check(acc, 'output', {
        userId,
        refId: assistantMsg.id,
      });
      const flagged = outMod.action === 'block';
      const storedContent = flagged ? OUTPUT_BLOCKED_NOTICE : acc;

      const { inputTokens, outputTokens } = await this.finalizeMessage(
        assistantMsg.id,
        storedContent,
        model,
        contextTurns,
        flagged ? 'content_filter' : finishReason,
        flagged,
        acc,
        realUsage,
      );

      await settle(inputTokens + outputTokens);
      await this.usage.record({
        userId,
        feature: 'chat',
        model,
        inputTokens,
        outputTokens,
        messageId: assistantMsg.id,
        idempotencyKey: `chat:${assistantMsg.id}`,
      });

      yield {
        event: 'message.done',
        data: {
          finish_reason: flagged ? 'content_filter' : finishReason,
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          ...(flagged ? { flagged: true, filtered_content: storedContent } : {}),
        },
      };
    } finally {
      await settle(estimatedInput + estimateTokens(acc));
    }
  }

  private async finalizeMessage(
    messageId: string,
    content: string,
    model: ModelId,
    contextTurns: ChatTurn[],
    finishReason: string,
    flagged: boolean,
    billBasis?: string,
    realUsage?: TokenUsage | null,
  ): Promise<{ inputTokens: number; outputTokens: number }> {
    // 优先使用上游返回的真实 usage；拿不到时用本地估算兜底。
    // 计费/落库的输出 token 基于实际生成内容(billBasis)，content 可能是脱敏文本。
    const inputTokens =
      realUsage?.inputTokens ?? contextTurns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
    const outputTokens = realUsage?.outputTokens ?? estimateTokens(billBasis ?? content);
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

  /**
   * 组装送给模型的上下文。
   *
   * @param opts.excludeMessageId 刚落库、稍后会作为 userContent 追加的消息，避免重复。
   * @param opts.beforeSeq 只取该序号之前的历史。重新生成时截断到目标回复之前，
   *   否则模型会看到「问题 → 旧答案 → 同一个问题」，重生成结果被旧答案带偏。
   */
  private async buildContext(
    conversation: Conversation,
    userContent: string,
    opts: { excludeMessageId?: string; beforeSeq?: number } = {},
  ): Promise<ChatTurn[]> {
    const assistant = conversation.assistantId
      ? await this.prisma.assistant.findUnique({ where: { id: conversation.assistantId } })
      : null;

    // 取「最近」HISTORY_LIMIT 条历史：倒序查询后反转为时间正序，
    // 避免长会话里永远只带上最早的历史而丢失近期上下文。
    // 多取一倍，为剔除被重新生成取代的旧回复留出余量。
    const recentRows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        content: { not: '' },
        ...(opts.excludeMessageId ? { id: { not: opts.excludeMessageId } } : {}),
        ...(opts.beforeSeq !== undefined ? { seq: { lt: opts.beforeSeq } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: HISTORY_LIMIT * 2,
      select: { id: true, role: true, content: true, parentId: true },
    });

    // 被某条消息的 parentId 指向的，是「重新生成前」的旧版本回复。
    // 新回复总是排在旧回复之后，因此在这个倒序窗口内一定能一并取到。
    const superseded = new Set(
      recentRows.map((m) => m.parentId).filter((id): id is string => id !== null),
    );

    const history = recentRows
      .filter((m) => !superseded.has(m.id))
      .slice(0, HISTORY_LIMIT)
      .reverse()
      .map((m) => ({
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
      // 多模态附件（图片 URL 数组），看图问答的消息会带此字段
      attachments: Array.isArray(m.attachments) ? (m.attachments as string[]) : null,
      finish_reason: m.finishReason,
      usage: { input_tokens: m.inputTokens, output_tokens: m.outputTokens },
      parent_id: m.parentId,
      created_at: m.createdAt,
    };
  }
}
