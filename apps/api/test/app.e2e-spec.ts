import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AppException } from '../src/common/errors';

/**
 * 端到端测试：覆盖 P1 核心链路（注册 → 会话 → 流式对话(非流式聚合) → 创作 → 审核 → 用量）。
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
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
});
