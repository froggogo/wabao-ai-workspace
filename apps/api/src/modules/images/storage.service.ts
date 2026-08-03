import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';

export interface StoredFile {
  /** 可公开访问的相对路径，如 /uploads/img_xxx.png */
  url: string;
  /** 磁盘绝对路径 */
  path: string;
  bytes: number;
  mimeType: string;
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

/**
 * 媒体存储抽象层。
 * P2 默认实现为「本地磁盘 + Nest 静态托管」，便于零依赖本地跑通。
 * 生产可通过 MEDIA_DRIVER=s3 切换到对象存储（预留扩展点，仅存引用不改业务代码）。
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  /** 磁盘根目录（绝对路径） */
  readonly rootDir: string;
  /** 对外 URL 前缀 */
  readonly publicPrefix = '/uploads';
  /** 可选的绝对地址前缀（配置 MEDIA_PUBLIC_BASE_URL 时用于返回全量 URL） */
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const dir = this.config.get<string>('MEDIA_ROOT') ?? 'uploads';
    this.rootDir = resolve(process.cwd(), dir);
    this.publicBaseUrl = (this.config.get<string>('MEDIA_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
  }

  /** 写入二进制文件，返回可访问 URL */
  async save(data: Buffer, mimeType: string, prefix = 'img'): Promise<StoredFile> {
    await mkdir(this.rootDir, { recursive: true });
    const ext = MIME_EXT[mimeType] ?? '.png';
    const name = `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}${ext}`;
    const path = join(this.rootDir, name);
    await writeFile(path, data);
    return {
      url: `${this.publicPrefix}/${name}`,
      path,
      bytes: data.byteLength,
      mimeType,
    };
  }

  /** 保存 base64（OpenAI 图像 API 返回 b64_json） */
  async saveBase64(b64: string, mimeType = 'image/png', prefix = 'img'): Promise<StoredFile> {
    return this.save(Buffer.from(b64, 'base64'), mimeType, prefix);
  }

  /** 从远端 URL 拉取并落盘（部分模型返回临时 URL，需转存以免过期） */
  async saveFromUrl(url: string, prefix = 'img'): Promise<StoredFile> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`拉取图片失败：HTTP ${res.status}`);
    }
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    return this.save(buf, mimeType, prefix);
  }

  /** 删除文件（幂等，失败仅告警，不阻塞业务） */
  async remove(url: string): Promise<void> {
    if (!url.startsWith(`${this.publicPrefix}/`)) return;
    const name = basename(url);
    // 防路径穿越：只允许操作根目录下的普通文件名
    if (!name || name.includes('..') || !extname(name)) return;
    try {
      await unlink(join(this.rootDir, name));
    } catch (e) {
      this.logger.debug(`删除媒体文件失败（忽略）：${(e as Error).message}`);
    }
  }

  /** 相对 URL → 可被外部（含模型服务）访问的绝对 URL */
  toAbsoluteUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${url}` : url;
  }

  /** 稳定哈希，用于 mock 模式按 prompt 生成确定性的占位图配色 */
  hash(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }
}
