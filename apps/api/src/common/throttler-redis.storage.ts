import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * 基于 Redis 的限流存储。多副本部署时共享计数；未配置 REDIS_URL 时
 * ThrottlerModule 回退到内置内存存储即可。
 *
 * 键结构：
 *   hits  → wabao:throttle:{name}:{tracker}
 *   block → wabao:throttle-block:{name}:{tracker}
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RedisThrottler');
  private readonly redis: Redis;

  private constructor(redis: Redis) {
    this.redis = redis;
  }

  static async connect(url: string): Promise<RedisThrottlerStorage> {
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await redis.connect();
    const storage = new RedisThrottlerStorage(redis);
    storage.logger.log(`限流存储已切换到 Redis（${url.replace(/\/\/.*@/, '//***@')}）`);
    return storage;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `wabao:throttle:${throttlerName}:${key}`;
    const blockKey = `wabao:throttle-block:${throttlerName}:${key}`;

    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockTtl / 1000),
      };
    }

    const totalHits = await this.redis.incr(hitsKey);
    if (totalHits === 1) {
      await this.redis.pexpire(hitsKey, ttl);
    }
    const pttl = await this.redis.pttl(hitsKey);
    const timeToExpire = Math.max(1, Math.ceil(pttl / 1000));

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit) {
      isBlocked = true;
      // blockDuration 与 ttl 同为毫秒（见 @nestjs/throttler 默认存储）
      const blockMs = blockDuration > 0 ? blockDuration : ttl;
      await this.redis.set(blockKey, '1', 'PX', blockMs);
      timeToBlockExpire = Math.ceil(blockMs / 1000);
    }

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }

  async disconnect(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
