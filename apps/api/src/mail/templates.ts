import { DEFAULT_LOCALE, type Locale } from '@dmflow/shared';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Escapes for HTML text nodes and attribute values.
 *
 * Names and workspace names come from users, and they land in the body of a
 * message sent to somebody else's inbox — the one place where an unescaped
 * apostrophe is a nuisance and an unescaped tag is an attack.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * One layout for every message.
 *
 * Deliberately plain: table-free, inline-styled, no images and no web fonts.
 * Anything cleverer is what mail clients break, and a password reset that
 * renders as a wall of raw CSS in Outlook is worse than a plain one everywhere.
 */
function layout(options: {
  heading: string;
  body: string[];
  action?: { label: string; url: string };
  footer: string;
}): string {
  const paragraphs = options.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#2c3138;">${line}</p>`,
    )
    .join('');

  const button = options.action
    ? `<p style="margin:0 0 24px;">
         <a href="${escapeHtml(options.action.url)}"
            style="display:inline-block;padding:12px 22px;border-radius:8px;background:#111418;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
           ${escapeHtml(options.action.label)}
         </a>
       </p>
       <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#6b7280;word-break:break-all;">
         ${escapeHtml(options.action.url)}
       </p>`
    : '';

  return `<div style="margin:0;padding:32px 16px;background:#f6f7f9;">
  <div style="max-width:520px;margin:0 auto;padding:32px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <p style="margin:0 0 24px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;">DM FLOW</p>
    <h1 style="margin:0 0 20px;font-size:20px;line-height:1.35;color:#111418;">${escapeHtml(options.heading)}</h1>
    ${paragraphs}
    ${button}
    <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280;">${options.footer}</p>
  </div>
</div>`;
}

function plain(lines: string[], action?: { label: string; url: string }, footer?: string): string {
  const parts = [...lines];
  if (action) parts.push('', `${action.label}: ${action.url}`);
  if (footer) parts.push('', footer);
  return parts.join('\n');
}

const COPY = {
  'pt-BR': {
    expiresHours: (hours: number) =>
      `Este link vale por ${hours} hora${hours === 1 ? '' : 's'}.`,
    ignore: 'Se você não pediu isso, ignore esta mensagem — nada muda.',
    neverAsk: 'A DM FLOW nunca pede sua senha por e-mail.',
    verify: {
      subject: 'Confirme seu e-mail — DM FLOW',
      heading: 'Confirme seu e-mail',
      intro: (name: string) => `Olá, ${name}. Falta um passo para sua conta ficar completa.`,
      action: 'Confirmar e-mail',
    },
    reset: {
      subject: 'Redefinir sua senha — DM FLOW',
      heading: 'Redefinir sua senha',
      intro: 'Recebemos um pedido para redefinir a senha da sua conta.',
      action: 'Criar nova senha',
    },
    invite: {
      subject: (workspace: string) => `Convite para ${workspace} — DM FLOW`,
      heading: (workspace: string) => `Você foi convidado para ${workspace}`,
      intro: (inviter: string, workspace: string, role: string) =>
        `${inviter} convidou você para participar de ${workspace} como ${role}.`,
      needsAccount:
        'Se você ainda não tem conta, o link leva ao cadastro — use este mesmo endereço de e-mail.',
      action: 'Aceitar convite',
    },
    roles: {
      OWNER: 'proprietário',
      ADMIN: 'administrador',
      EDITOR: 'editor',
      AGENT: 'atendente',
      VIEWER: 'observador',
    } as Record<string, string>,
  },
  en: {
    expiresHours: (hours: number) => `This link is valid for ${hours} hour${hours === 1 ? '' : 's'}.`,
    ignore: 'If you did not request this, ignore this message — nothing changes.',
    neverAsk: 'DM FLOW will never ask for your password by email.',
    verify: {
      subject: 'Confirm your email — DM FLOW',
      heading: 'Confirm your email',
      intro: (name: string) => `Hi ${name}. One step left to finish setting up your account.`,
      action: 'Confirm email',
    },
    reset: {
      subject: 'Reset your password — DM FLOW',
      heading: 'Reset your password',
      intro: 'We received a request to reset the password on your account.',
      action: 'Set a new password',
    },
    invite: {
      subject: (workspace: string) => `Invitation to ${workspace} — DM FLOW`,
      heading: (workspace: string) => `You have been invited to ${workspace}`,
      intro: (inviter: string, workspace: string, role: string) =>
        `${inviter} invited you to join ${workspace} as ${role}.`,
      needsAccount:
        'If you do not have an account yet, the link takes you to sign-up — use this same email address.',
      action: 'Accept invitation',
    },
    roles: {
      OWNER: 'owner',
      ADMIN: 'admin',
      EDITOR: 'editor',
      AGENT: 'agent',
      VIEWER: 'viewer',
    } as Record<string, string>,
  },
} as const;

function copyFor(locale: Locale) {
  return COPY[locale] ?? COPY[DEFAULT_LOCALE];
}

export function renderEmailVerification(options: {
  locale: Locale;
  name: string;
  url: string;
  expiresHours: number;
}): RenderedMail {
  const c = copyFor(options.locale);
  const body = [c.verify.intro(options.name), c.expiresHours(options.expiresHours)];

  return {
    subject: c.verify.subject,
    text: plain(body, { label: c.verify.action, url: options.url }, c.ignore),
    html: layout({
      heading: c.verify.heading,
      body: body.map(escapeHtml),
      action: { label: c.verify.action, url: options.url },
      footer: escapeHtml(c.ignore),
    }),
  };
}

export function renderPasswordReset(options: {
  locale: Locale;
  url: string;
  expiresHours: number;
}): RenderedMail {
  const c = copyFor(options.locale);
  const body = [c.reset.intro, c.expiresHours(options.expiresHours)];

  return {
    subject: c.reset.subject,
    text: plain(body, { label: c.reset.action, url: options.url }, `${c.ignore} ${c.neverAsk}`),
    html: layout({
      heading: c.reset.heading,
      body: body.map(escapeHtml),
      action: { label: c.reset.action, url: options.url },
      footer: escapeHtml(`${c.ignore} ${c.neverAsk}`),
    }),
  };
}

export function renderInvitation(options: {
  locale: Locale;
  inviterName: string;
  workspaceName: string;
  role: string;
  url: string;
  expiresHours: number;
}): RenderedMail {
  const c = copyFor(options.locale);
  const roleLabel = c.roles[options.role] ?? options.role.toLowerCase();
  const body = [
    c.invite.intro(options.inviterName, options.workspaceName, roleLabel),
    c.invite.needsAccount,
    c.expiresHours(options.expiresHours),
  ];

  return {
    subject: c.invite.subject(options.workspaceName),
    text: plain(body, { label: c.invite.action, url: options.url }, c.ignore),
    html: layout({
      heading: c.invite.heading(options.workspaceName),
      body: body.map(escapeHtml),
      action: { label: c.invite.action, url: options.url },
      footer: escapeHtml(c.ignore),
    }),
  };
}
