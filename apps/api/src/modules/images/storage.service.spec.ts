import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { StorageService } from './storage.service';

function makeService(root: string, publicBase = ''): StorageService {
  const env: Record<string, string> = { MEDIA_ROOT: root, MEDIA_PUBLIC_BASE_URL: publicBase };
  const config = { get: <T>(k: string): T | undefined => env[k] as unknown as T } as ConfigService;
  return new StorageService(config);
}

describe('StorageService（P2 媒体存储）', () => {
  let root: string;
  let service: StorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wabao-media-'));
    service = makeService(root);
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
      // 文件确实落盘且内容一致
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

    it('未知 MIME 回退为 .png', async () => {
      const out = await service.save(Buffer.from('x'), 'application/octet-stream');
      expect(out.url.endsWith('.png')).toBe(true);
    });

    it('支持自定义文件名前缀（区分生成 / 变体 / 上传）', async () => {
      const gen = await service.save(Buffer.from('a'), 'image/png');
      const variation = await service.save(Buffer.from('b'), 'image/png', 'var');
      const upload = await service.save(Buffer.from('c'), 'image/png', 'up');

      expect(gen.url).toContain('/uploads/img_');
      expect(variation.url).toContain('/uploads/var_');
      expect(upload.url).toContain('/uploads/up_');
    });

    it('多次保存生成互不冲突的文件名', async () => {
      const outs = await Promise.all(
        Array.from({ length: 8 }, () => service.save(Buffer.from('same'), 'image/png')),
      );
      expect(new Set(outs.map((o) => o.url)).size).toBe(8);
      expect(await readdir(root)).toHaveLength(8);
    });

    it('目标目录不存在时自动创建', async () => {
      const nested = join(root, 'a', 'b', 'c');
      const svc = makeService(nested);
      const out = await svc.save(Buffer.from('x'), 'image/png');
      expect((await readFile(out.path)).toString()).toBe('x');
    });
  });

  describe('saveBase64', () => {
    it('正确解码 base64 内容', async () => {
      const raw = '<svg>mock</svg>';
      const out = await service.saveBase64(
        Buffer.from(raw, 'utf8').toString('base64'),
        'image/svg+xml',
      );
      expect((await readFile(out.path)).toString()).toBe(raw);
      expect(out.bytes).toBe(Buffer.byteLength(raw));
    });
  });

  describe('remove', () => {
    it('删除已存在的文件', async () => {
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
      // 原文件不应被误删
      expect(await readdir(root)).toHaveLength(1);
      expect((await readFile(out.path)).toString()).toBe('x');
    });

    it('防路径穿越：不会删除根目录之外的文件', async () => {
      const outside = join(root, '..', `outside-${Date.now()}.txt`);
      await writeFile(outside, 'keep');
      try {
        await service.remove('/uploads/../../outside.txt');
        // 目标文件必须仍然存在
        expect((await readFile(outside)).toString()).toBe('keep');
      } finally {
        await rm(outside, { force: true });
      }
    });

    it('忽略没有扩展名的可疑名称', async () => {
      await expect(service.remove('/uploads/noext')).resolves.toBeUndefined();
    });
  });

  describe('toAbsoluteUrl', () => {
    it('未配置 MEDIA_PUBLIC_BASE_URL 时保持相对路径', () => {
      expect(service.toAbsoluteUrl('/uploads/a.png')).toBe('/uploads/a.png');
    });

    it('配置后拼接为绝对地址（供上游视觉模型访问）', () => {
      const svc = makeService(root, 'https://cdn.example.com');
      expect(svc.toAbsoluteUrl('/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png');
    });

    it('自动去除 base url 末尾多余斜杠，避免双斜杠', () => {
      const svc = makeService(root, 'https://cdn.example.com/');
      expect(svc.toAbsoluteUrl('/uploads/a.png')).toBe('https://cdn.example.com/uploads/a.png');
    });

    it('已是完整 http(s) URL 时原样返回', () => {
      const svc = makeService(root, 'https://cdn.example.com');
      const url = 'https://other.com/x.png';
      expect(svc.toAbsoluteUrl(url)).toBe(url);
    });
  });

  describe('hash', () => {
    it('同一输入得到稳定哈希，不同输入不同', () => {
      expect(service.hash('abc')).toBe(service.hash('abc'));
      expect(service.hash('abc')).not.toBe(service.hash('abd'));
    });
  });
});
