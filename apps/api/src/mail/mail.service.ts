import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@dmflow/shared';
import { loadEnv } from '../config/env';
import { logger } from '../common/logger';
import {
  renderEmailVerification,
  renderInvitation,
  renderPasswordReset,
  type RenderedMail,
} from './templates';

export interface SendResult {
  delivered: boolean;
  /** Present only under the log transport, so development can follow the link. */
  previewUrl?: string;
}

function toLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Outbound email.
 *
 * Two transports. `smtp` sends. `log` writes the whole message to the log and
 * returns the link, which is what makes invitations and password resets
 * testable without an SMTP dependency — and is refused outright in production by
 * the environment check, because a transport that silently swallows a password
 * reset is worse than one that fails loudly.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private transporter: Transporter | null = null;

  private get from(): string {
    const env = loadEnv();
    return `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`;
  }

  private smtp(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport(loadEnv().SMTP_URL);
    }
    return this.transporter;
  }

  /**
   * Never throws.
   *
   * Every caller here is in the middle of something that already succeeded — the
   * account exists, the invitation row is written — so a mail server having a bad
   * minute must not roll that back or hand the user an error for work that was
   * done. The failure is logged, loudly, and reported in the return value so the
   * caller can tell the user the message did not go out.
   */
  async send(to: string, mail: RenderedMail): Promise<SendResult> {
    const env = loadEnv();

    if (env.MAIL_TRANSPORT === 'log') {
      logger.info(
        { to, subject: mail.subject, body: mail.text },
        'email not sent (MAIL_TRANSPORT=log) — printed instead',
      );
      return { delivered: false, previewUrl: this.firstUrl(mail.text) };
    }

    try {
      await this.smtp().sendMail({
        from: this.from,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      logger.info({ to, subject: mail.subject }, 'email sent');
      return { delivered: true };
    } catch (error) {
      // The address is logged; the body is not. Bodies carry reset links.
      logger.error(
        { to, subject: mail.subject, err: error instanceof Error ? error.message : String(error) },
        'email delivery failed',
      );
      return { delivered: false };
    }
  }

  sendEmailVerification(options: {
    to: string;
    name: string;
    locale: string | null | undefined;
    token: string;
    expiresHours: number;
  }): Promise<SendResult> {
    const url = this.webUrl('/verify-email', options.token);
    return this.send(
      options.to,
      renderEmailVerification({
        locale: toLocale(options.locale),
        name: options.name,
        url,
        expiresHours: options.expiresHours,
      }),
    );
  }

  sendPasswordReset(options: {
    to: string;
    locale: string | null | undefined;
    token: string;
    expiresHours: number;
  }): Promise<SendResult> {
    const url = this.webUrl('/reset-password', options.token);
    return this.send(
      options.to,
      renderPasswordReset({
        locale: toLocale(options.locale),
        url,
        expiresHours: options.expiresHours,
      }),
    );
  }

  sendInvitation(options: {
    to: string;
    locale: string | null | undefined;
    inviterName: string;
    workspaceName: string;
    role: string;
    token: string;
    expiresHours: number;
  }): Promise<SendResult> {
    const url = this.webUrl('/accept-invite', options.token);
    return this.send(
      options.to,
      renderInvitation({
        locale: toLocale(options.locale),
        inviterName: options.inviterName,
        workspaceName: options.workspaceName,
        role: options.role,
        url,
        expiresHours: options.expiresHours,
      }),
    );
  }

  private webUrl(path: string, token: string): string {
    const base = loadEnv().WEB_URL.replace(/\/$/, '');
    return `${base}${path}?token=${encodeURIComponent(token)}`;
  }

  private firstUrl(text: string): string | undefined {
    return /https?:\/\/\S+/.exec(text)?.[0];
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter?.close();
  }
}
