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
    emailChange: {
      subject: 'Confirme seu novo e-mail — DM FLOW',
      heading: 'Confirme seu novo e-mail',
      intro: (current: string) =>
        `Foi pedida a troca do e-mail da conta ${current} para este endereço.`,
      onlyAfter:
        'O endereço da sua conta só muda depois que você clicar no botão abaixo. Até lá, continua valendo o antigo.',
      action: 'Confirmar este e-mail',
      wrongPerson:
        'Se você não pediu isso, não clique. Nada acontece, e o link expira sozinho.',
    },
    emailChangeNotice: {
      subject: 'Pediram para trocar o e-mail da sua conta — DM FLOW',
      heading: 'Pediram para trocar o e-mail da sua conta',
      intro: (masked: string) =>
        `Chegou um pedido para mudar o e-mail desta conta para ${masked}. Enviamos um link de confirmação para lá.`,
      noLink:
        'Esta mensagem não tem link de confirmação de propósito: quem confirma é quem tem acesso ao endereço novo.',
      wasYou: 'Se foi você, não precisa fazer nada aqui.',
      wasNotYou:
        'Se NÃO foi você, alguém pode estar com acesso à sua conta. Troque sua senha agora — isso cancela o pedido e desconecta todos os aparelhos.',
    },
    accountDeleted: {
      subject: 'Sua conta na DM FLOW foi excluída',
      heading: 'Sua conta foi excluída',
      intro:
        'Confirmando: sua conta na DM FLOW foi excluída, junto com os dados que estavam nela.',
      irreversible:
        'Isso não tem volta e não guardamos cópia para restaurar. Se quiser voltar a usar a plataforma, é criar uma conta nova, do zero.',
      wasNotYou:
        'Se não foi você que pediu isso, responda esta mensagem imediatamente.',
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
    emailChange: {
      subject: 'Confirm your new email — DM FLOW',
      heading: 'Confirm your new email',
      intro: (current: string) =>
        `Someone asked to move the account ${current} to this address.`,
      onlyAfter:
        'Your account address only changes after you click the button below. Until then the old one still works.',
      action: 'Confirm this email',
      wrongPerson: 'If you did not ask for this, do not click. Nothing happens and the link expires on its own.',
    },
    emailChangeNotice: {
      subject: 'Someone asked to change your account email — DM FLOW',
      heading: 'Someone asked to change your account email',
      intro: (masked: string) =>
        `We received a request to change this account's email to ${masked}. A confirmation link was sent there.`,
      noLink:
        'This message deliberately carries no confirmation link: only whoever holds the new address can confirm.',
      wasYou: 'If this was you, there is nothing to do here.',
      wasNotYou:
        'If this was NOT you, someone may have access to your account. Change your password now — that cancels the request and signs every device out.',
    },
    accountDeleted: {
      subject: 'Your DM FLOW account was deleted',
      heading: 'Your account was deleted',
      intro: 'Confirming: your DM FLOW account was deleted, along with the data it held.',
      irreversible:
        'This cannot be undone and we keep no copy to restore from. To use the platform again you would start a new account from scratch.',
      wasNotYou: 'If you did not ask for this, reply to this message immediately.',
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

/**
 * Enviado ao endereço NOVO. É o único que carrega o link.
 *
 * A troca fica presa aqui de propósito: quem tem uma sessão roubada consegue
 * pedir a troca, mas não consegue confirmá-la sem também ter a caixa de entrada
 * do endereço novo — que é dele, não da vítima. É esse segundo fator que impede
 * o sequestro da conta.
 */
export function renderEmailChangeConfirmation(options: {
  locale: Locale;
  currentEmail: string;
  url: string;
  expiresHours: number;
}): RenderedMail {
  const c = copyFor(options.locale);
  const body = [
    c.emailChange.intro(options.currentEmail),
    c.emailChange.onlyAfter,
    c.expiresHours(options.expiresHours),
  ];

  return {
    subject: c.emailChange.subject,
    text: plain(body, { label: c.emailChange.action, url: options.url }, c.emailChange.wrongPerson),
    html: layout({
      heading: c.emailChange.heading,
      body: body.map(escapeHtml),
      action: { label: c.emailChange.action, url: options.url },
      footer: escapeHtml(c.emailChange.wrongPerson),
    }),
  };
}

/**
 * Enviado ao endereço ANTIGO, e sem link nenhum.
 *
 * Existe para uma única situação: alguém entrou na conta e está tentando trocar
 * o e-mail para se apossar dela. O dono legítimo precisa saber disso enquanto
 * ainda tem acesso — e precisa saber o que fazer, que é trocar a senha.
 *
 * Sem link porque um link aqui seria exatamente o que um golpe imitaria.
 */
export function renderEmailChangeNotice(options: {
  locale: Locale;
  maskedNewEmail: string;
}): RenderedMail {
  const c = copyFor(options.locale);
  const body = [
    c.emailChangeNotice.intro(options.maskedNewEmail),
    c.emailChangeNotice.noLink,
    c.emailChangeNotice.wasYou,
    c.emailChangeNotice.wasNotYou,
  ];

  return {
    subject: c.emailChangeNotice.subject,
    text: plain(body, undefined, c.neverAsk),
    html: layout({
      heading: c.emailChangeNotice.heading,
      body: body.map(escapeHtml),
      footer: escapeHtml(c.neverAsk),
    }),
  };
}

/**
 * O comprovante da exclusão, enviado logo antes de apagar.
 *
 * Antes, não depois: depois de apagar não existe mais endereço para onde
 * mandar. E é o único registro que sobra do lado de quem saiu — dentro da
 * plataforma, por definição, não sobrou nada.
 */
export function renderAccountDeleted(options: { locale: Locale }): RenderedMail {
  const c = copyFor(options.locale);
  const body = [c.accountDeleted.intro, c.accountDeleted.irreversible];

  return {
    subject: c.accountDeleted.subject,
    text: plain(body, undefined, c.accountDeleted.wasNotYou),
    html: layout({
      heading: c.accountDeleted.heading,
      body: body.map(escapeHtml),
      footer: escapeHtml(c.accountDeleted.wasNotYou),
    }),
  };
}
