import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  /** BullMQ requires its own connection with maxRetriesPerRequest disabled. */
  readonly queueConnection: Redis;

  constructor() {
    const url = loadEnv().REDIS_URL;
    this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.queueConnection = new Redis(url, { maxRetriesPerRequest: null });
    this.client.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
  }

  /**
   * Best-effort dedupe. It is a fast path, never the only guard: the database
   * unique constraint is what actually guarantees an event is processed once.
   */
  async claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(`once:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  /** Simple distributed lock for work that must not run concurrently. */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = Math.random().toString(36).slice(2);
    const acquired = await this.client.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (acquired !== 'OK') return undefined;
    try {
      return await fn();
    } finally {
      const current = await this.client.get(`lock:${key}`);
      if (current === token) await this.client.del(`lock:${key}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.queueConnection.quit()]);
  }
}
