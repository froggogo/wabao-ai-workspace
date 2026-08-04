import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve, extname, basename } from 'node:path';

export interface StoredFile {
  /** 可公开访问的相对路径，如 /uploads/img_xxx.png（库内只存无签名形态） */
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
 * P2 默认实现为「本地磁盘 + 签名访问」，便于零依赖本地跑通。
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
  /** HMAC 密钥；缺省回退到 JWT_ACCESS_SECRET */
  private readonly signingSecret: string;
  /** 签名链接有效期（秒） */
  private readonly urlTtlSeconds: number;
  /** 是否强制校验签名（false 时开放读取，仅本地调试用） */
  readonly requireSigned: boolean;

  constructor(private readonly config: ConfigService) {
    const dir = this.config.get<string>('MEDIA_ROOT') ?? 'uploads';
    this.rootDir = resolve(process.cwd(), dir);
    this.publicBaseUrl = (this.config.get<string>('MEDIA_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    this.signingSecret =
      this.config.get<string>('MEDIA_SIGNING_SECRET') ||
      this.config.get<string>('JWT_ACCESS_SECRET') ||
      'dev_media_signing_secret';
    this.urlTtlSeconds = Number(this.config.get('MEDIA_URL_TTL_SECONDS') ?? 3600);
    const flag = (this.config.get<string>('MEDIA_REQUIRE_SIGNED') ?? 'true').toLowerCase();
    this.requireSigned = flag !== 'false' && flag !== '0';
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
    const relative = this.stripQuery(url);
    if (!relative.startsWith(`${this.publicPrefix}/`)) return;
    const name = basename(relative);
    // 防路径穿越：只允许操作根目录下的普通文件名
    if (!name || name.includes('..') || !extname(name)) return;
    try {
      await unlink(join(this.rootDir, name));
    } catch (e) {
      this.logger.debug(`删除媒体文件失败（忽略）：${(e as Error).message}`);
    }
  }

  /**
   * 给相对路径签上时效签名。库内永远存无签名 URL；对外返回（DTO / 上游拉取）才签名。
   * MEDIA_REQUIRE_SIGNED=false 时原样返回，方便本地无签名调试。
   */
  signUrl(url: string, ttlSeconds = this.urlTtlSeconds): string {
    const relative = this.toRelativeUrl(url);
    if (!this.requireSigned) return relative;
    if (!relative.startsWith(`${this.publicPrefix}/`)) return relative;
    const name = basename(relative);
    const exp = String(Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds));
    const sig = this.hmac(name, exp);
    return `${relative}?exp=${exp}&sig=${sig}`;
  }

  /** 校验文件名 + exp + sig；过期或篡改返回 false */
  verifySignature(fileName: string, exp: string, sig: string): boolean {
    if (!fileName || !exp || !sig) return false;
    const expSec = Number(exp);
    if (!Number.isFinite(expSec) || expSec < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = this.hmac(fileName, exp);
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(sig);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** 相对 URL → 可被外部（含模型服务）访问的绝对 URL；需要签名时一并带上 */
  toAbsoluteUrl(url: string): string {
    if (/^https?:\/\//i.test(url) && !url.includes(this.publicPrefix)) return url;
    const signed = this.signUrl(url);
    if (/^https?:\/\//i.test(signed)) return signed;
    return this.publicBaseUrl ? `${this.publicBaseUrl}${signed}` : signed;
  }

  /**
   * 绝对 / 签名 URL → 站内相对路径（无 query），用于与数据库中存储的 url 比对。
   * 非本站地址原样返回，由调用方按「查不到即拒绝」处理。
   */
  toRelativeUrl(url: string): string {
    const bare = this.stripQuery(url);
    if (this.publicBaseUrl && bare.startsWith(`${this.publicBaseUrl}/`)) {
      return bare.slice(this.publicBaseUrl.length);
    }
    // 兼容带 host 的本站地址：…/uploads/xxx.png
    const idx = bare.indexOf(`${this.publicPrefix}/`);
    if (idx > 0 && /^https?:\/\//i.test(bare)) {
      return bare.slice(idx);
    }
    return bare;
  }

  /** 稳定哈希，用于 mock 模式按 prompt 生成确定性的占位图配色 */
  hash(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }

  private hmac(fileName: string, exp: string): string {
    return createHmac('sha256', this.signingSecret).update(`${fileName}:${exp}`).digest('hex');
  }

  private stripQuery(url: string): string {
    return url.split('?')[0]?.split('#')[0] ?? url;
  }
}
