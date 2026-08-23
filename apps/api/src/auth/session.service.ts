import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { DmFlowError, randomToken, uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../common/crypto';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';

export const SESSION_COOKIE = 'dmflow_sid';
const SESSION_TTL_DAYS = 30;
/** Rotate when the session is more than this old, to limit the window of a stolen cookie. */
const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    userId: string,
    meta: { ip?: string; userAgent?: string },
    res: Response,
  ): Promise<string> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

    await this.prisma.session.create({
      data: {
        id: uuidv7(),
        userId,
        refreshTokenHash: hashToken(token),
        ip: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt,
      },
    });

    this.setCookie(res, token, expiresAt);
    return token;
  }

  /**
   * Resolves a session token. A token that exists but was already revoked means the
   * cookie leaked and is being replayed — we kill every session for that user rather
   * than let an attacker ride alongside the legitimate one.
   */
  async resolve(token: string): Promise<{ userId: string; sessionId: string; rotate: boolean }> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(token) },
    });

    if (!session) throw new DmFlowError('NOT_AUTHENTICATED');

    if (session.revokedAt) {
      await this.revokeAllForUser(session.userId);
      logger.warn({ userId: session.userId }, 'session reuse detected, all sessions revoked');
      throw new DmFlowError('SESSION_REUSE_DETECTED', { context: { userId: session.userId } });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new DmFlowError('NOT_AUTHENTICATED', { context: { reason: 'expired' } });
    }

    return {
      userId: session.userId,
      sessionId: session.id,
      rotate: Date.now() - session.createdAt.getTime() > ROTATE_AFTER_MS,
    };
  }

  async rotate(sessionId: string, res: Response): Promise<void> {
    const existing = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!existing || existing.revokedAt) return;

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: {
          id: uuidv7(),
          userId: existing.userId,
          refreshTokenHash: hashToken(token),
          ip: existing.ip,
          userAgent: existing.userAgent,
          expiresAt,
        },
      }),
    ]);

    this.setCookie(res, token, expiresAt);
  }

  async revoke(sessionId: string, res: Response): Promise<void> {
    await this.prisma.session
      .update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
    this.clearCookie(res);
  }

  /** Returns how many sessions were actually ended, for the record of why. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  private setCookie(res: Response, token: string, expiresAt: Date): void {
    const env = loadEnv();
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // A cookie readable by JavaScript turns any XSS into full account takeover.
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  private clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
