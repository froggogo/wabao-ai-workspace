import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { StorageService } from './storage.service';

function makeService(
  root: string,
  opts: { publicBase?: string; requireSigned?: boolean; secret?: string; ttl?: number } = {},
): StorageService {
  const env: Record<string, string> = {
    MEDIA_ROOT: root,
    MEDIA_PUBLIC_BASE_URL: opts.publicBase ?? '',
    MEDIA_REQUIRE_SIGNED: opts.requireSigned === false ? 'false' : 'true',
    MEDIA_SIGNING_SECRET: opts.secret ?? 'test_secret',
    MEDIA_URL_TTL_SECONDS: String(opts.ttl ?? 3600),
  };
  const config = { get: <T>(k: string): T | undefined => env[k] as unknown as T } as ConfigService;
  return new StorageService(config);
}

describe('StorageService（P2 媒体存储）', () => {
  let root: string;
  let service: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wabao-media-'));
    // 既有用例按「开放读取」口径断言 URL 形态；签名行为另有专测
    service = makeService(root, { requireSigned: false });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('save', () => {
    it('写入文件并返回可访问 URL 与绝对路径', async () => {
      const data = Buffer.from('hello-image');
      const out = await service.save(data, 'image/png');

      expect(out.url.startsWith('/uploads/')).toBe(true);
      expect(out.url.endsWith('.png')).toBe(true);
      expect(isAbsolute(out.path)).toBe(true);
      expect(out.bytes).toBe(data.byteLength);
      expect(out.mimeType).toBe('image/png');
      expect((await readFile(out.path)).toString()).toBe('hello-image');
    });

    it('按 MIME 类型推断扩展名', async () => {
      const cases: [string, string][] = [
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['image/webp', '.webp'],
        ['image/gif', '.gif'],
        ['image/svg+xml', '.svg'],
      ];
      for (const [mime, ext] of cases) {
        const out = await service.save(Buffer.from('x'), mime);
        expect(out.url.endsWith(ext)).toBe(true);
      }
    });
  });

  describe('remove', () => {
    it('删除已落盘文件', async () => {
      const out = await service.save(Buffer.from('x'), 'image/png');
      await service.remove(out.url);
      expect(await readdir(root)).toHaveLength(0);
    });

    it('删除不存在的文件不抛错（幂等）', async () => {
      await expect(service.remove('/uploads/not_exists.png')).resolves.toBeUndefined();
    });

    it('忽略非本服务前缀的 URL', async () => {
      const out = await service.save(Buffer.from('x'), 'image/png');
      await service.remove('https://cdn.example.com/a.png');
      await service.remove('/other/a.png');
      expect(await readdir(root)).toHaveLength(1);
      expect((await readFile(out.path)).toString()).toBe('x');
    });

    it('防路径穿越：不会删除根目录之外的文件', async () => {
      const outside = join(root, '..', `outside-${Date.now()}.txt`);
      await writeFile(outside, 'keep');
      try {
        await service.remove('/uploads/../../outside.txt');
        expect((await readFile(outside)).toString()).toBe('keep');
      } finally {
        await rm(outside, { force: true });
      }
    });

    it('忽略没有扩展名的可疑名称', async () => {
      await expect(service.remove('/uploads/noext')).resolves.toBeUndefined();
    });

    it('可删除带签名 query 的 URL', async () => {
      const out = await service.save(Buffer.from('x'), 'image/png');
      await service.remove(`${out.url}?exp=1&sig=abc`);
      expect(await readdir(root)).toHaveLength(0);
    });
  });

  describe('签名 URL', () => {
    it('signUrl 附带 exp 与 sig，verify 通过', () => {
      const svc = makeService(root, { requireSigned: true, secret: 's1' });
      const signed = svc.signUrl('/uploads/a.png');
      expect(signed).toMatch(/^\/uploads\/a\.png\?exp=\d+&sig=[0-9a-f]+$/);
      const u = new URL(signed, 'http://local');
      expect(svc.verifySignature('a.png', u.searchParams.get('exp')!, u.searchParams.get('sig')!)).toBe(
        true,
      );
    });

    it('篡改文件名或签名会失败', () => {
      const svc = makeService(root, { requireSigned: true, secret: 's1' });
      const signed = svc.signUrl('/uploads/a.png');
      const u = new URL(signed, 'http://local');
      expect(svc.verifySignature('b.png', u.searchParams.get('exp')!, u.searchParams.get('sig')!)).toBe(
        false,
      );
      expect(svc.verifySignature('a.png', u.searchParams.get('exp')!, 'deadbeef')).toBe(false);
    });

    it('过期签名失败', () => {
      const svc = makeService(root, { requireSigned: true, secret: 's1' });
      const exp = String(Math.floor(Date.now() / 1000) - 10);
      expect(svc.verifySignature('a.png', exp, '00')).toBe(false);
    });

    it('MEDIA_REQUIRE_SIGNED=false 时 signUrl 原样返回', () => {
      expect(service.signUrl('/uploads/a.png')).toBe('/uploads/a.png');
    });

    it('toAbsoluteUrl 在强制签名时带上 query', () => {
      const svc = makeService(root, {
        requireSigned: true,
        publicBase: 'https://cdn.example.com',
        secret: 's1',
      });
      const abs = svc.toAbsoluteUrl('/uploads/a.png');
      expect(abs.startsWith('https://cdn.example.com/uploads/a.png?')).toBe(true);
      expect(svc.toRelativeUrl(abs)).toBe('/uploads/a.png');
    });
  });

  describe('toAbsoluteUrl', () => {
    it('未配置 MEDIA_PUBLIC_BASE_URL 时保持相对路径', () => {
      expect(service.toAbsoluteUrl('/uploads/a.png')).toBe('/uploads/a.png');
    });

    it('配置后拼接为绝对地址（供上游视觉模型访问）', () => {
      const svc = makeService(root, { publicBase: 'https://cdn.example.com', requireSigned: false });
      expect(svc.toAbsoluteUrl('/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png');
    });

    it('自动去除 base url 末尾多余斜杠，避免双斜杠', () => {
      const svc = makeService(root, { publicBase: 'https://cdn.example.com/', requireSigned: false });
      expect(svc.toAbsoluteUrl('/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png');
    });

    it('已是完整 http(s) URL 且非本站 uploads 时原样返回', () => {
      const svc = makeService(root, { publicBase: 'https://cdn.example.com', requireSigned: false });
      const url = 'https://other.com/x.png';
      expect(svc.toAbsoluteUrl(url)).toBe(url);
    });
  });

  describe('toRelativeUrl', () => {
    it('未配置 base url 时原样返回', () => {
      expect(service.toRelativeUrl('/uploads/a.png')).toBe('/uploads/a.png');
    });

    it('剥离本站 base url 前缀，便于与库中存储的相对路径比对', () => {
      const svc = makeService(root, { publicBase: 'https://cdn.example.com', requireSigned: false });
      expect(svc.toRelativeUrl('https://cdn.example.com/uploads/a.png')).toBe('/uploads/a.png');
    });

    it('与 toAbsoluteUrl 互为逆运算', () => {
      const svc = makeService(root, { publicBase: 'https://cdn.example.com', requireSigned: false });
      expect(svc.toRelativeUrl(svc.toAbsoluteUrl('/uploads/a.png'))).toBe('/uploads/a.png');
    });

    it('剥离签名 query', () => {
      expect(service.toRelativeUrl('/uploads/a.png?exp=1&sig=abc')).toBe('/uploads/a.png');
    });

    it('任意 host 下的 /uploads/ 都归一化为相对路径（归属校验仍要求库内存在）', () => {
      expect(service.toRelativeUrl('https://evil.com/uploads/a.png')).toBe('/uploads/a.png');
    });
  });

  describe('hash', () => {
    it('同一输入得到稳定哈希，不同输入不同', () => {
      expect(service.hash('abc')).toBe(service.hash('abc'));
      expect(service.hash('abc')).not.toBe(service.hash('abd'));
    });
  });
});
