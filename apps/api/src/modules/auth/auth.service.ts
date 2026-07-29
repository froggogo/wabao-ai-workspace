import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors';
import { RegisterDto, LoginDto, ChangePasswordDto } from './dto/auth.dto';

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) {
      throw new AppException('conflict', '该邮箱已注册');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name?.trim() || dto.email.split('@')[0],
      },
    });
    await this.seedDefaultAssistants(user.id);
    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.publicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new AppException('unauthorized', '邮箱或密码错误');
    }
    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.publicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new AppException('unauthorized', '刷新令牌无效或已过期');
    }
    if (payload.type !== 'refresh') {
      throw new AppException('unauthorized', '令牌类型错误');
    }
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(refreshToken) },
    });
    if (!record || record.revoked || record.expiresAt < new Date()) {
      throw new AppException('unauthorized', '刷新令牌已失效');
    }
    // 轮换：旧 token 失效，签发新 token
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true },
    });
    return this.issueTokens(payload.sub, payload.email);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(refreshToken) },
      data: { revoked: true },
    });
  }

  /** 修改密码：校验原密码 → 更新哈希 → 吊销全部 refresh token（强制重新登录） */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException('not_found', '用户不存在');
    }
    const ok = await bcrypt.compare(dto.old_password, user.passwordHash);
    if (!ok) {
      throw new AppException('unauthorized', '原密码不正确');
    }
    if (dto.old_password === dto.new_password) {
      throw new AppException('invalid_request', '新密码不能与原密码相同');
    }
    const passwordHash = await bcrypt.hash(dto.new_password, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { revoked: true },
    });
    return { success: true };
  }

  private async issueTokens(userId: string, email: string): Promise<Tokens> {
    const accessTtl = Number(this.config.get('JWT_ACCESS_TTL') ?? 3600);
    const refreshTtl = Number(this.config.get('JWT_REFRESH_TTL') ?? 1209600);

    const access_token = await this.jwt.signAsync(
      { sub: userId, email, type: 'access' },
      { secret: this.config.get<string>('JWT_ACCESS_SECRET'), expiresIn: accessTtl },
    );
    const refresh_token = await this.jwt.signAsync(
      { sub: userId, email, type: 'refresh', jti: randomUUID() },
      { secret: this.config.get<string>('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(refresh_token),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    // 顺带清理该用户已吊销/过期的 refresh token，避免表无限增长
    await this.cleanupRefreshTokens(userId);

    return { access_token, refresh_token, expires_in: accessTtl };
  }

  /** 删除该用户已吊销或已过期的 refresh token（不影响当前有效令牌） */
  private async cleanupRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken
      .deleteMany({
        where: {
          userId,
          OR: [{ revoked: true }, { expiresAt: { lt: new Date() } }],
        },
      })
      .catch(() => undefined);
  }

  private async seedDefaultAssistants(userId: string): Promise<void> {
    await this.prisma.assistant.createMany({
      data: [
        {
          userId,
          name: '通用助手',
          avatar: '🤖',
          systemPrompt: '你是蛙宝，一个乐于助人、回答简洁清晰的通用 AI 助手。',
          defaultModel: 'gpt-5.6-terra',
        },
        {
          userId,
          name: '代码专家',
          avatar: '💻',
          systemPrompt: '你是资深软件工程师，擅长以最佳实践给出可运行的代码与解释。',
          defaultModel: 'gpt-5.6-sol',
        },
        {
          userId,
          name: '文案高手',
          avatar: '✍️',
          systemPrompt: '你是营销文案专家，擅长写出有感染力、符合平台调性的文案。',
          defaultModel: 'gpt-5.6-terra',
        },
      ],
    });
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private publicUser(user: { id: string; email: string; name: string; avatar: string | null }) {
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar };
  }
}
