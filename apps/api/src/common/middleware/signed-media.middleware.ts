import { Logger } from '@nestjs/common';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { NextFunction, Request, Response } from 'express';
import { StorageService } from '../../modules/images/storage.service';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/**
 * 受保护的媒体托管：替代 Express 裸 static。
 * - MEDIA_REQUIRE_SIGNED=true（默认）时必须带有效 ?exp=&sig=
 * - 设为 false 时开放读取（仅建议本地调试）
 */
export function createSignedMediaMiddleware(storage: StorageService) {
  const logger = new Logger('Media');
  const requireSigned = storage.requireSigned;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const prefix = storage.publicPrefix; // /uploads
    if (!req.path.startsWith(`${prefix}/`)) {
      next();
      return;
    }

    const name = req.path.slice(prefix.length + 1);
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      res.status(400).end();
      return;
    }

    if (requireSigned) {
      const exp = typeof req.query.exp === 'string' ? req.query.exp : '';
      const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
      if (!storage.verifySignature(name, exp, sig)) {
        res.status(403).json({ error: { code: 'forbidden', message: '媒体链接无效或已过期' } });
        return;
      }
    }

    const filePath = join(storage.rootDir, name);
    if (!existsSync(filePath)) {
      res.status(404).end();
      return;
    }

    try {
      const st = statSync(filePath);
      const mime = MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', String(st.size));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (req.method === 'HEAD') {
        res.status(200).end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch (err) {
      logger.warn(`读取媒体失败：${(err as Error).message}`);
      res.status(500).end();
    }
  };
}
