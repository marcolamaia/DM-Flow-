import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import type { Response } from 'express';
import {
  DEFAULT_LOCALE,
  DmFlowError,
  FREE_PLAN_CODE,
  isLocale,
  randomToken,
  slugify,
  uuidv7,
  type Locale,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import { SecretBox, hashToken } from '../common/crypto';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';
import { MailService } from '../mail/mail.service';
import { DomainEventsService } from '../admin/domain-events.service';

const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly secretBox: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly events: DomainEventsService,
  ) {
    this.secretBox = new SecretBox(loadEnv().ENCRYPTION_KEY);
  }

  async register(
    input: { email: string; password: string; name: string; workspaceName?: string; locale?: string },
    meta: { ip?: string; userAgent?: string },
    res: Response,
  ) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new DmFlowError('EMAIL_ALREADY_REGISTERED');

    const locale: Locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
    const passwordHash = await argon2.hash(input.password, ARGON_OPTIONS);
    const userId = uuidv7();
    const workspaceId = uuidv7();
    const workspaceName = input.workspaceName?.trim() || `${input.name.split(' ')[0]}'s workspace`;

    const freePlan = await this.prisma.plan.findUnique({ where: { code: FREE_PLAN_CODE } });
    if (!freePlan) {
      throw new DmFlowError('INTERNAL_ERROR', {
        cause: 'Free plan missing — run the seed before allowing signups',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, email, passwordHash, name: input.name.trim(), locale },
      });
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: workspaceName,
          slug: await this.uniqueSlug(workspaceName),
          locale,
        },
      });
      await tx.workspaceMember.create({
        data: { id: uuidv7(), workspaceId, userId, role: 'OWNER' },
      });
      await tx.subscription.create({
        data: { id: uuidv7(), workspaceId, planId: freePlan.id, status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          id: uuidv7(),
          workspaceId,
          actorType: 'USER',
          actorUserId: userId,
          action: 'workspace.created',
          entityType: 'Workspace',
          entityId: workspaceId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      });
    });

    await this.sessions.issue(userId, meta, res);
    logger.info({ userId, workspaceId }, 'user registered');

    // Recorded as two facts rather than one. "How many people signed up" and
    // "how many accounts exist" stop being the same question the moment somebody
    // is invited into a workspace instead of creating theirs.
    await this.events.recordMany([
      { event: 'user.registered', userId, workspaceId, properties: { locale } },
      { event: 'workspace.created', workspaceId, userId, properties: { plan: FREE_PLAN_CODE } },
    ]);

    // Sent after the transaction commits. Inside it, a slow mail server would
    // hold a database transaction open, and a failed send would roll back an
    // account the person can already sign in to.
    await this.issueEmailVerification(userId, email, input.name.trim(), locale);

    return { userId, workspaceId };
  }

  async login(
    input: { email: string; password: string; totp?: string },
    meta: { ip?: string; userAgent?: string },
    res: Response,
  ) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a verification so a missing account and a wrong password cost the
    // same time — otherwise response timing enumerates registered emails.
    const hash = user?.passwordHash ?? (await this.dummyHash());
    const valid = await argon2.verify(hash, input.password).catch(() => false);

    if (!user || !valid || user.deletedAt) {
      // The address is recorded in properties, not in userId: a failure against
      // an address nobody registered has no user to attach it to, and inventing
      // one would make the count of failed logins wrong.
      await this.events.record({
        event: 'user.login_failed',
        userId: user?.id ?? null,
        properties: { reason: user ? (user.deletedAt ? 'deleted' : 'password') : 'no_account' },
      });
      throw new DmFlowError('INVALID_CREDENTIALS');
    }

    // After the password check, so a blocked account is not a way to learn that
    // an address is registered without knowing its password.
    if (user.suspendedAt) throw new DmFlowError('ACCOUNT_SUSPENDED');

    if (user.totpEnabledAt && user.totpSecretEnc) {
      if (!input.totp) throw new DmFlowError('TOTP_REQUIRED');
      const secret = this.secretBox.decrypt(user.totpSecretEnc);
      if (!authenticator.check(input.totp, secret)) {
        throw new DmFlowError('TOTP_INVALID');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.sessions.issue(user.id, meta, res);
    await this.events.record({ event: 'user.logged_in', userId: user.id });
    return { userId: user.id };
  }

  async logout(sessionId: string | undefined, res: Response): Promise<void> {
    if (sessionId) await this.sessions.revoke(sessionId, res);
  }

  /**
   * Always reports success. Telling an anonymous caller whether an address is
   * registered is the same leak as a distinct login error.
   */
  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) return {};

    const token = randomToken(32);
    await this.prisma.passwordResetToken.create({
      data: {
        id: uuidv7(),
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    const result = await this.mail.sendPasswordReset({
      to: user.email,
      locale: user.locale,
      token,
      expiresHours: RESET_TTL_MS / 3_600_000,
    });

    logger.info({ userId: user.id, delivered: result.delivered }, 'password reset requested');

    // Under the log transport the link is handed back so the flow is exercisable
    // without an SMTP server. Never under a real transport: the response would
    // then be a way to obtain a reset link for any address.
    return result.previewUrl ? { token } : {};
  }

  /**
   * Issues a fresh verification token and emails it.
   *
   * Any token already outstanding for this user is consumed first. Leaving old
   * ones live means a link from a previous address change still verifies, and
   * "resend" would quietly widen the window every time it is pressed.
   */
  private async issueEmailVerification(
    userId: string,
    email: string,
    name: string,
    locale: string,
  ): Promise<{ token?: string; delivered: boolean }> {
    const token = randomToken(32);

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          id: uuidv7(),
          userId,
          email,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      }),
    ]);

    const result = await this.mail.sendEmailVerification({
      to: email,
      name,
      locale,
      token,
      expiresHours: VERIFY_TTL_MS / 3_600_000,
    });

    return { token: result.previewUrl ? token : undefined, delivered: result.delivered };
  }

  /** Re-sends the verification email. Silent about accounts that are already verified. */
  async resendEmailVerification(userId: string): Promise<{ token?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt || user.emailVerifiedAt) return {};

    const { token } = await this.issueEmailVerification(
      user.id,
      user.email,
      user.name,
      user.locale,
    );
    return token ? { token } : {};
  }

  async verifyEmail(token: string): Promise<{ email: string }> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new DmFlowError('VERIFICATION_TOKEN_INVALID');
    }

    // The address may have been changed after the token was issued. Verifying the
    // current address off a token issued for a previous one would prove nothing.
    if (record.user.email !== record.email) {
      throw new DmFlowError('VERIFICATION_TOKEN_INVALID', {
        context: { reason: 'email_changed' },
      });
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    logger.info({ userId: record.userId }, 'email verified');
    await this.events.record({ event: 'user.email_verified', userId: record.userId });
    return { email: record.email };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new DmFlowError('RESET_TOKEN_INVALID');
    }

    const passwordHash = await argon2.hash(newPassword, ARGON_OPTIONS);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Uma troca de e-mail em aberto morre aqui.
      //
      // O roteiro que isto corta: alguém entra na conta, pede a troca do e-mail
      // para um endereço dele, e espera. O dono percebe, redefine a senha — e
      // sem esta linha o link de troca continuaria válido na caixa do invasor,
      // pronto para tomar a conta depois que a poeira baixasse.
      this.prisma.emailChangeRequest.updateMany({
        where: { userId: record.userId, usedAt: null, canceledAt: null },
        data: { canceledAt: new Date() },
      }),
    ]);

    // A password change invalidates every existing session, everywhere.
    await this.sessions.revokeAllForUser(record.userId);
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DmFlowError('NOT_AUTHENTICATED');

    const valid = await argon2.verify(user.passwordHash, current).catch(() => false);
    if (!valid) throw new DmFlowError('INVALID_CREDENTIALS');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await argon2.hash(next, ARGON_OPTIONS) },
      }),
      // Pelo mesmo motivo do reset: ver o comentário em resetPassword.
      this.prisma.emailChangeRequest.updateMany({
        where: { userId, usedAt: null, canceledAt: null },
        data: { canceledAt: new Date() },
      }),
    ]);
    await this.sessions.revokeAllForUser(userId);
  }

  async startTotpEnrollment(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: this.secretBox.encrypt(secret), totpEnabledAt: null },
    });
    return {
      secret,
      otpauthUrl: authenticator.keyuri(email, 'DM FLOW', secret),
    };
  }

  async confirmTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc) throw new DmFlowError('TOTP_INVALID');

    const secret = this.secretBox.decrypt(user.totpSecretEnc);
    if (!authenticator.check(code, secret)) throw new DmFlowError('TOTP_INVALID');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
  }

  async disableTotp(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new DmFlowError('NOT_AUTHENTICATED');

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) throw new DmFlowError('INVALID_CREDENTIALS');

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabledAt: null },
    });
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'workspace';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomToken(3).toLowerCase()}`;
      const taken = await this.prisma.workspace.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private dummyHashCache?: string;
  private async dummyHash(): Promise<string> {
    this.dummyHashCache ??= await argon2.hash('dmflow-timing-equaliser', ARGON_OPTIONS);
    return this.dummyHashCache;
  }
}
