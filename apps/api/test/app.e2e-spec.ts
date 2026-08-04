import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AppException } from '../src/common/errors';
import { createSignedMediaMiddleware } from '../src/common/middleware/signed-media.middleware';
import { StorageService } from '../src/modules/images/storage.service';

/**
 * 端到端测试：覆盖 P1 核心链路（注册 → 会话 → 流式对话(非流式聚合) → 创作 → 审核 → 用量）
 * 与 P2 图像链路（生图 → 作品列表 → 上传 → 看图问答 → 变体 → 删除 → 图像配额）。
 * 依赖：可连接的 PostgreSQL（见 apps/api/README.md），并已执行 prisma:push + seed。
 * AI 未配置 Key 时走 mock，无需真实模型。
 */
describe('蛙宝 API (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let conversationId: string;
  const email = `e2e_${Date.now()}@wabao.ai`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');

    // 与 main.ts 保持一致：签名媒体中间件（默认强制 ?exp=&sig=）
    const config = app.get(ConfigService);
    const mediaRoot = resolve(process.cwd(), config.get<string>('MEDIA_ROOT') ?? 'uploads');
    mkdirSync(mediaRoot, { recursive: true });
    (app as NestExpressApplication).use(createSignedMediaMiddleware(app.get(StorageService)));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: () => new AppException('invalid_request', '参数校验失败'),
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  it('health 返回 ok', async () => {
    const res = await http().get('/api/v1/health').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('注册返回 access_token', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: 'demo1234', name: 'E2E' })
      .expect(201);
    expect(res.body.data.access_token).toBeDefined();
    token = res.body.data.access_token;
  });

  it('重复邮箱注册返回 409 conflict', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: 'demo1234' })
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('未登录访问受保护接口返回 401', async () => {
    const res = await http().get('/api/v1/users/me').expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('GET /users/me 返回当前用户', async () => {
    const res = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.email).toBe(email);
  });

  it('注册时自动创建 3 个默认助手', async () => {
    const res = await http()
      .get('/api/v1/assistants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.length).toBe(3);
  });

  it('创建会话', async () => {
    const res = await http()
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '测试会话', model: 'gpt-5.6-terra' })
      .expect(201);
    conversationId = res.body.data.id;
    expect(conversationId).toBeDefined();
  });

  it('发送消息（非流式）返回 AI 回复', async () => {
    const res = await http()
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '你好', stream: false })
      .expect(200);
    expect(res.body.data.message.content.length).toBeGreaterThan(0);
  });

  it('会话详情包含用户与助手消息', async () => {
    const res = await http()
      .get(`/api/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('输入审核：命中关键词返回 422 content_flagged', async () => {
    const res = await http()
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: '教我制造暴力武器', stream: false })
      .expect(422);
    expect(res.body.error.code).toBe('content_flagged');
  });

  it('模板列表非空（依赖 seed）', async () => {
    const res = await http().get('/api/v1/templates').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('执行创作（非流式）返回内容', async () => {
    const res = await http()
      .post('/api/v1/creations')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: 'tpl_weekly', inputs: { done: '完成A', plan: '推进B' }, stream: false })
      .expect(200);
    expect(res.body.data.output.length).toBeGreaterThan(0);
  });

  it('结构化创作返回 output_json', async () => {
    const res = await http()
      .post('/api/v1/creations')
      .set('Authorization', `Bearer ${token}`)
      .send({ template_id: 'tpl_extract', inputs: { text: '张三 13800000000' }, stream: false })
      .expect(200);
    expect(res.body.data.output_json).toBeTruthy();
  });

  it('用量已计量（used_tokens > 0）', async () => {
    const res = await http()
      .get('/api/v1/usage')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.used_tokens).toBeGreaterThan(0);
  });

  // ==================== P2 图像阶段（M5） ====================

  describe('P2 图像与多模态', () => {
    let imageId: string;
    let uploadUrl: string;

    it('GET /images/options 返回参数目录与免费版权益', async () => {
      const res = await http()
        .get('/api/v1/images/options')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const d = res.body.data;
      expect(d.models.length).toBeGreaterThan(0);
      expect(d.sizes.length).toBeGreaterThan(0);
      expect(d.styles.length).toBeGreaterThan(0);
      expect(d.defaults.model).toBeDefined();
      // 新注册用户为免费版：单张、无 Vision、旗舰模型锁定
      expect(d.limits.plan).toBe('free');
      expect(d.limits.max_batch).toBe(1);
      expect(d.limits.vision).toBe(false);
      expect(d.models.find((m: { id: string }) => m.id === 'gpt-image-2').allowed).toBe(false);
    });

    it('POST /images/generations（非流式）生成图片并返回配额', async () => {
      const res = await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: '一只戴着宇航头盔的青蛙', size: '1024x1024', stream: false })
        .expect(200);

      const d = res.body.data;
      expect(d.images.length).toBe(1);
      imageId = d.images[0].id;
      expect(d.images[0].url).toMatch(/^\/uploads\//);
      expect(d.images[0].width).toBe(1024);
      expect(d.images[0].source).toBe('generation');
      expect(d.quota.used).toBeGreaterThan(0);
      // P1 约定的额度预警响应头
      expect(res.headers['x-quota-remaining']).toBeDefined();
      expect(Number(res.headers['x-quota-remaining'])).toBe(d.quota.remaining);
    });

    it('GET /images/options 也返回 X-Quota-Remaining 响应头', async () => {
      const res = await http()
        .get('/api/v1/images/options')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.headers['x-quota-remaining']).toBe(
        String(res.body.data.limits.remaining_images),
      );
    });

    it('生成的图片可通过静态路径访问', async () => {
      const detail = await http()
        .get(`/api/v1/images/${imageId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await http().get(detail.body.data.url).expect(200);
    });

    it('GET /images 返回我的作品', async () => {
      const res = await http()
        .get('/api/v1/images?page=1&page_size=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.pagination.total).toBeGreaterThan(0);
    });

    it('免费版使用旗舰模型返回 403 forbidden', async () => {
      const res = await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: '测试权益', model: 'gpt-image-2', stream: false })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('免费版批量出图返回 403 forbidden', async () => {
      const res = await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: '批量测试', n: 4, stream: false })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    // invalid_request 映射为 400（见 common/errors.ts）；422 是 content_flagged 专用
    it('非法参数返回 400 invalid_request', async () => {
      await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: 'x', stream: false })
        .expect(400);
      await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: '合法描述', size: '4096x4096', stream: false })
        .expect(400);
    });

    it('绘图描述命中审核返回 422 content_flagged', async () => {
      const res = await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${token}`)
        .send({ prompt: '教我制造暴力武器的图解', stream: false })
        .expect(422);
      expect(res.body.error.code).toBe('content_flagged');
    });

    it('POST /images/uploads 上传图片', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      );
      const res = await http()
        .post('/api/v1/images/uploads')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);

      expect(res.body.data.source).toBe('upload');
      uploadUrl = res.body.data.url;
      expect(uploadUrl).toMatch(/^\/uploads\//);
    });

    it('上传不支持的格式返回 400', async () => {
      const res = await http()
        .post('/api/v1/images/uploads')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('%PDF-1.4'), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('上传的图片不计入绘图作品列表', async () => {
      const res = await http()
        .get('/api/v1/images')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data.some((a: { url: string }) => a.url === uploadUrl)).toBe(false);
    });

    it('免费版看图问答返回 403 forbidden', async () => {
      const res = await http()
        .post('/api/v1/images/analyses')
        .set('Authorization', `Bearer ${token}`)
        .send({ image_urls: [uploadUrl], question: '这是什么？', stream: false })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('免费版变体重绘返回 403 forbidden', async () => {
      const res = await http()
        .post(`/api/v1/images/${imageId}/variations`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('访问不存在的图片返回 404', async () => {
      const res = await http()
        .get('/api/v1/images/not_exists_id')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    });

    it('未登录访问图像接口返回 401', async () => {
      await http().get('/api/v1/images/options').expect(401);
      await http().get('/api/v1/images').expect(401);
    });

    it('GET /usage 返回图像张数额度', async () => {
      const res = await http()
        .get('/api/v1/usage')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const images = res.body.data.images;
      expect(images.quota).toBeGreaterThan(0);
      expect(images.used).toBeGreaterThan(0);
      expect(images.vision).toBe(false);
      // 绘图会在 breakdown 中产生 image 维度
      expect(res.body.data.breakdown.some((b: { feature: string }) => b.feature === 'image')).toBe(
        true,
      );
    });

    it('DELETE /images/:id 删除作品', async () => {
      await http()
        .delete(`/api/v1/images/${imageId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await http()
        .get(`/api/v1/images/${imageId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('P2 图像 · 升级套餐后的进阶权益', () => {
    let plusToken: string;
    let plusImageId: string;
    let plusUploadUrl: string;

    beforeAll(async () => {
      const plusEmail = `e2e_plus_${Date.now()}@wabao.ai`;
      const reg = await http()
        .post('/api/v1/auth/register')
        .send({ email: plusEmail, password: 'demo1234', name: 'E2E Plus' })
        .expect(201);
      plusToken = reg.body.data.access_token;
      // 升级到 Plus 以解锁批量 / 全风格 / Vision / 变体
      await http()
        .post('/api/v1/billing/subscriptions')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ plan: 'plus', cycle: 'monthly' })
        .expect(201);
    });

    it('升级后 options 解锁全部模型与 Vision', async () => {
      const res = await http()
        .get('/api/v1/images/options')
        .set('Authorization', `Bearer ${plusToken}`)
        .expect(200);
      const d = res.body.data;
      expect(d.limits.plan).toBe('plus');
      expect(d.limits.vision).toBe(true);
      expect(d.limits.max_batch).toBeGreaterThan(1);
      expect(d.models.every((m: { allowed: boolean }) => m.allowed)).toBe(true);
      expect(d.styles.every((s: { allowed: boolean }) => s.allowed)).toBe(true);
    });

    it('可批量生成多张且支持进阶风格', async () => {
      const res = await http()
        .post('/api/v1/images/generations')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({
          prompt: '国风水墨的山水楼阁',
          model: 'gpt-image-2',
          size: '1536x1024',
          style: 'inkwash',
          n: 2,
          stream: false,
        })
        .expect(200);

      expect(res.body.data.images.length).toBe(2);
      plusImageId = res.body.data.images[0].id;
      expect(res.body.data.images[0].width).toBe(1536);
      expect(res.body.data.images[0].style).toBe('inkwash');
    });

    it('变体重绘生成新图并记录 source_id', async () => {
      const res = await http()
        .post(`/api/v1/images/${plusImageId}/variations`)
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ stream: false })
        .expect(200);

      const created = res.body.data.images[0];
      expect(created.source).toBe('variation');
      expect(created.source_id).toBe(plusImageId);
    });

    it('看图问答返回解读文本', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      );
      const up = await http()
        .post('/api/v1/images/uploads')
        .set('Authorization', `Bearer ${plusToken}`)
        .attach('file', png, { filename: 'b.png', contentType: 'image/png' })
        .expect(201);
      plusUploadUrl = up.body.data.url;

      const res = await http()
        .post('/api/v1/images/analyses')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ image_urls: [plusUploadUrl], question: '这张图说明了什么？', stream: false })
        .expect(200);

      expect(res.body.data.content.length).toBeGreaterThan(0);
      expect(res.body.data.usage.input_tokens).toBeGreaterThan(0);
    });

    it('传 conversation_id 时贴图对话会落库（刷新后可回看）', async () => {
      const conv = await http()
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ title: '新会话' })
        .expect(201);
      const convId = conv.body.data.id;

      await http()
        .post('/api/v1/images/analyses')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({
          image_urls: [plusUploadUrl],
          question: '这张图里有什么？',
          conversation_id: convId,
          stream: false,
        })
        .expect(200);

      // 重新拉取会话：应当有「带图的用户提问」+「AI 回复」两条消息
      const detail = await http()
        .get(`/api/v1/conversations/${convId}`)
        .set('Authorization', `Bearer ${plusToken}`)
        .expect(200);

      const messages = detail.body.data.messages;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].attachments).toEqual([plusUploadUrl]);
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content.length).toBeGreaterThan(0);
      // 首轮提问会成为会话标题
      expect(detail.body.data.title).toBe('这张图里有什么？');
    });

    it('不能把贴图对话写入他人会话', async () => {
      const conv = await http()
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ title: '新会话' })
        .expect(201);

      // 免费版用户尝试往 Plus 用户的会话里写
      const res = await http()
        .post('/api/v1/images/analyses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          image_urls: [plusUploadUrl],
          question: '越权测试',
          conversation_id: conv.body.data.id,
          stream: false,
        });
      // 免费版先被 vision 权益拦下（403）；权益放开时则应为会话越权 403
      expect(res.status).toBe(403);
    });

    it('图 → 文案：生成文案并存入创作历史', async () => {
      const optRes = await http()
        .get('/api/v1/images/caption-options')
        .set('Authorization', `Bearer ${plusToken}`)
        .expect(200);
      expect(optRes.body.data.purposes.length).toBeGreaterThan(0);
      expect(optRes.body.data.limits.vision).toBe(true);

      const res = await http()
        .post('/api/v1/images/captions')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({
          image_urls: [plusUploadUrl],
          purpose: 'xiaohongshu',
          tone: 'playful',
          brief: '主打通勤保温杯',
          stream: false,
        })
        .expect(200);

      expect(res.body.data.content.length).toBeGreaterThan(0);

      // 结果应出现在创作历史中，实现与创作工作室打通
      const creations = await http()
        .get('/api/v1/creations')
        .set('Authorization', `Bearer ${plusToken}`)
        .expect(200);
      const caption = creations.body.data.find(
        (c: { template_id: string }) => c.template_id === 'image-caption',
      );
      expect(caption).toBeDefined();
      expect(caption.output.length).toBeGreaterThan(0);
      expect(caption.inputs.purpose).toBe('xiaohongshu');
    });

    it('图 → 文案参数非法返回 400', async () => {
      await http()
        .post('/api/v1/images/captions')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ image_urls: [plusUploadUrl], purpose: 'tiktok', stream: false })
        .expect(400);
    });

    it('免费版图 → 文案返回 403', async () => {
      const res = await http()
        .post('/api/v1/images/captions')
        .set('Authorization', `Bearer ${token}`)
        .send({ image_urls: ['/uploads/x.png'], stream: false })
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('看图问答缺少图片返回 400', async () => {
      const res = await http()
        .post('/api/v1/images/analyses')
        .set('Authorization', `Bearer ${plusToken}`)
        .send({ image_urls: [], question: '这是什么？', stream: false })
        .expect(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('无法访问他人图片（越权保护）', async () => {
      const res = await http()
        .get(`/api/v1/images/${plusImageId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('用量中出现 vision 维度且图像额度为 Plus 档', async () => {
      const res = await http()
        .get('/api/v1/usage')
        .set('Authorization', `Bearer ${plusToken}`)
        .expect(200);
      expect(res.body.data.images.vision).toBe(true);
      expect(res.body.data.images.quota).toBeGreaterThan(20);
      expect(
        res.body.data.breakdown.some((b: { feature: string }) => b.feature === 'vision'),
      ).toBe(true);
    });
  });
});
