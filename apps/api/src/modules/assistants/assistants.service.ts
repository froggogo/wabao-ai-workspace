import { Injectable } from '@nestjs/common';
import { Assistant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { CreateAssistantDto, UpdateAssistantDto } from './dto/assistants.dto';

@Injectable()
export class AssistantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.assistant.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((a) => this.toDto(a));
  }

  async get(userId: string, id: string) {
    return this.toDto(await this.findOwned(userId, id));
  }

  async create(userId: string, dto: CreateAssistantDto) {
    const a = await this.prisma.assistant.create({
      data: {
        userId,
        name: dto.name,
        systemPrompt: dto.system_prompt,
        defaultModel: dto.default_model ?? 'gpt-5.6-terra',
        avatar: dto.avatar ?? '🤖',
      },
    });
    return this.toDto(a);
  }

  async update(userId: string, id: string, dto: UpdateAssistantDto) {
    await this.findOwned(userId, id);
    const a = await this.prisma.assistant.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.system_prompt !== undefined ? { systemPrompt: dto.system_prompt } : {}),
        ...(dto.default_model !== undefined ? { defaultModel: dto.default_model } : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
      },
    });
    return this.toDto(a);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.assistant.delete({ where: { id } });
  }

  private async findOwned(userId: string, id: string): Promise<Assistant> {
    const a = await this.prisma.assistant.findUnique({ where: { id } });
    if (!a) {
      throw new AppException('not_found', '助手不存在');
    }
    if (a.userId !== userId) {
      throw new AppException('forbidden', '无权访问该助手');
    }
    return a;
  }

  private toDto(a: Assistant) {
    return {
      id: a.id,
      name: a.name,
      avatar: a.avatar,
      system_prompt: a.systemPrompt,
      default_model: a.defaultModel,
      created_at: a.createdAt,
    };
  }
}
