import type { LocalizedMessage } from './locale.js';

export const CHANNELS = ['INSTAGRAM', 'MESSENGER', 'WHATSAPP'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Availability taxonomy.
 *
 * SANDBOX_SIMULATED deserves a note: it does NOT claim the real platform permits
 * something. It states that DM FLOW's own simulator implements this behaviour, which
 * is a fact about our code, not a claim about Meta. A sandbox capability can never be
 * used by a live account, and a live capability is never satisfied by the simulator.
 */
export type CapabilityStatus =
  | 'AVAILABLE_OFFICIAL_API'
  | 'AVAILABLE_WITH_RESTRICTIONS'
  | 'REQUIRES_APP_REVIEW'
  | 'REQUIRES_ADVANCED_ACCESS'
  | 'DEPENDS_ON_ACCOUNT_TYPE'
  | 'NOT_AVAILABLE'
  | 'NOT_CONFIRMED'
  | 'SANDBOX_SIMULATED';

const LIVE_AVAILABLE: readonly CapabilityStatus[] = [
  'AVAILABLE_OFFICIAL_API',
  'AVAILABLE_WITH_RESTRICTIONS',
];

export function isLiveAvailable(status: CapabilityStatus): boolean {
  return LIVE_AVAILABLE.includes(status);
}

/** How a window constrains an action. */
export type WindowRequirement =
  | 'NONE' // window irrelevant (e.g. a public comment reply)
  | 'OPEN' // requires an open messaging window
  | 'OPEN_OR_EXTENDED' // open window, or an extension mechanism
  | 'ORIGIN_EVENT'; // permitted only as a reply to the originating event

export type IdempotencyMode = 'NONE' | 'PER_EXECUTION_NODE' | 'ONE_SHOT_GLOBAL';

export interface DocReference {
  url: string;
  validatedAt: string | null;
  apiVersion: string | null;
}

export interface CapabilityEntry {
  id: string;
  channel: Channel;
  status: CapabilityStatus;
  /** Human label for the UI. */
  label: LocalizedMessage;
  /** What the operator must know about this capability's constraints. */
  limitations: LocalizedMessage;
  requiredScopes: string[];
  requiredAccountTypes: string[];
  windowRequirement: WindowRequirement;
  idempotency: IdempotencyMode;
  /** Documented limits. Empty until validated; runtime discovery is preferred. */
  documentedLimits: Record<string, number | string | null>;
  doc: DocReference;
  /** Open question that PHASE 0 must answer before this can go live. */
  pendingQuestion?: string;
}

const NOT_VALIDATED_DOC: DocReference = { url: '', validatedAt: null, apiVersion: null };

const SANDBOX_DOC: DocReference = {
  url: 'internal://dmflow/mock-instagram-provider',
  validatedAt: '2026-08-22',
  apiVersion: 'mock-1',
};

export const CAP = {
  IG_CONNECT_ACCOUNT: 'CAP_IG_CONNECT_ACCOUNT',
  IG_RECEIVE_DM: 'CAP_IG_RECEIVE_DM',
  IG_SEND_TEXT: 'CAP_IG_SEND_TEXT',
  IG_SEND_MEDIA: 'CAP_IG_SEND_MEDIA',
  IG_SEND_QUICK_REPLIES: 'CAP_IG_SEND_QUICK_REPLIES',
  IG_RECEIVE_QUICK_REPLY_PAYLOAD: 'CAP_IG_RECEIVE_QUICK_REPLY_PAYLOAD',
  IG_SEND_BUTTONS: 'CAP_IG_SEND_BUTTONS',
  IG_RECEIVE_COMMENT: 'CAP_IG_RECEIVE_COMMENT',
  IG_REPLY_COMMENT_PUBLIC: 'CAP_IG_REPLY_COMMENT_PUBLIC',
  IG_SEND_PRIVATE_REPLY: 'CAP_IG_SEND_PRIVATE_REPLY',
  IG_RECEIVE_STORY_REPLY: 'CAP_IG_RECEIVE_STORY_REPLY',
  IG_RECEIVE_STORY_MENTION: 'CAP_IG_RECEIVE_STORY_MENTION',
  IG_RECEIVE_LIVE_COMMENT: 'CAP_IG_RECEIVE_LIVE_COMMENT',
  IG_SET_ICE_BREAKERS: 'CAP_IG_SET_ICE_BREAKERS',
  IG_READ_CONVERSATIONS: 'CAP_IG_READ_CONVERSATIONS',
  IG_HUMAN_AGENT_WINDOW: 'CAP_IG_HUMAN_AGENT_WINDOW',
} as const;

export type CapabilityId = (typeof CAP)[keyof typeof CAP];

interface CapSeed {
  id: CapabilityId;
  label: LocalizedMessage;
  limitations: LocalizedMessage;
  windowRequirement: WindowRequirement;
  idempotency: IdempotencyMode;
  pendingQuestion: string;
  /** Behaviour the mock provider implements, when it implements one. */
  sandbox?: {
    windowRequirement?: WindowRequirement;
    documentedLimits?: Record<string, number | string | null>;
  };
}

const IG_SEEDS: CapSeed[] = [
  {
    id: CAP.IG_CONNECT_ACCOUNT,
    label: { 'pt-BR': 'Conectar conta do Instagram', en: 'Connect Instagram account' },
    limitations: {
      'pt-BR': 'Exige conta profissional e autorização do dono da conta.',
      en: 'Requires a professional account and the account owner’s authorization.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q1-Q7: which auth path, which scopes, which account types, token lifetime.',
    sandbox: {},
  },
  {
    id: CAP.IG_RECEIVE_DM,
    label: { 'pt-BR': 'Receber mensagem direta', en: 'Receive direct message' },
    limitations: {
      'pt-BR': 'Depende do webhook de mensagens estar assinado e entregue pela plataforma.',
      en: 'Depends on the messages webhook being subscribed and delivered by the platform.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q8-Q12: exact webhook field name, payload shape, signature header.',
    sandbox: {},
  },
  {
    id: CAP.IG_SEND_TEXT,
    label: { 'pt-BR': 'Enviar mensagem de texto', en: 'Send text message' },
    limitations: {
      'pt-BR': 'Só dentro da janela de mensagens aberta pela última mensagem do contato.',
      en: 'Only inside the messaging window opened by the contact’s last message.',
    },
    windowRequirement: 'OPEN',
    idempotency: 'PER_EXECUTION_NODE',
    pendingQuestion: 'Q14, Q18, Q19: endpoint, window duration, what may be sent outside it.',
    sandbox: { documentedLimits: { maxCharacters: 1000 } },
  },
  {
    id: CAP.IG_SEND_MEDIA,
    label: { 'pt-BR': 'Enviar mídia', en: 'Send media' },
    limitations: {
      'pt-BR': 'Tipos e tamanhos de mídia aceitos dependem do canal.',
      en: 'Accepted media types and sizes depend on the channel.',
    },
    windowRequirement: 'OPEN',
    idempotency: 'PER_EXECUTION_NODE',
    pendingQuestion: 'Q15, Q16: supported media types and size limits on Instagram specifically.',
    sandbox: { documentedLimits: { maxSizeMb: 8 } },
  },
  {
    id: CAP.IG_SEND_QUICK_REPLIES,
    label: { 'pt-BR': 'Enviar respostas rápidas', en: 'Send quick replies' },
    limitations: {
      'pt-BR':
        'A quantidade máxima de botões e onde eles aparecem dependem do canal e do app do usuário.',
      en: 'Maximum button count and where they render depend on the channel and the user’s app.',
    },
    windowRequirement: 'OPEN',
    idempotency: 'PER_EXECUTION_NODE',
    pendingQuestion: 'Q16, Q17: how many quick replies, and whether they render outside mobile.',
    sandbox: { documentedLimits: { maxQuickReplies: 3, maxTitleLength: 20 } },
  },
  {
    id: CAP.IG_RECEIVE_QUICK_REPLY_PAYLOAD,
    label: {
      'pt-BR': 'Saber qual resposta rápida foi tocada',
      en: 'Know which quick reply was tapped',
    },
    limitations: {
      'pt-BR':
        'Receber a mensagem é uma coisa; saber QUAL botão foi tocado é outra. Rotear por botão só é possível se o webhook entregar um identificador da opção escolhida, e não apenas o texto dela.',
      en: 'Receiving the message is one thing; knowing WHICH button was tapped is another. Routing by button is only possible if the webhook delivers an identifier for the chosen option, not merely its text.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion:
      'Q16, Q18: does the inbound webhook carry a payload identifying the quick reply that was tapped, and is it distinguishable from the contact typing the same words?',
    sandbox: {},
  },
  {
    id: CAP.IG_SEND_BUTTONS,
    label: { 'pt-BR': 'Enviar botões', en: 'Send buttons' },
    limitations: {
      'pt-BR': 'Suporte a botões varia por canal e superfície.',
      en: 'Button support varies by channel and surface.',
    },
    windowRequirement: 'OPEN',
    idempotency: 'PER_EXECUTION_NODE',
    pendingQuestion: 'Q15, Q17: are buttons supported on Instagram, and on which surfaces.',
  },
  {
    id: CAP.IG_RECEIVE_COMMENT,
    label: { 'pt-BR': 'Receber comentário em post ou reel', en: 'Receive post or reel comment' },
    limitations: {
      'pt-BR': 'Depende do webhook de comentários e da cobertura de reels.',
      en: 'Depends on the comments webhook and whether reels are covered.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q22, Q26: which event fires, and whether reels and nested replies count.',
    sandbox: {},
  },
  {
    id: CAP.IG_REPLY_COMMENT_PUBLIC,
    label: { 'pt-BR': 'Responder comentário publicamente', en: 'Reply to comment publicly' },
    limitations: {
      'pt-BR': 'Usa permissão diferente da de mensagens.',
      en: 'Uses a different permission from messaging.',
    },
    windowRequirement: 'NONE',
    idempotency: 'ONE_SHOT_GLOBAL',
    pendingQuestion: 'Q27: which permission is required to reply publicly to a comment.',
    sandbox: {},
  },
  {
    id: CAP.IG_SEND_PRIVATE_REPLY,
    label: { 'pt-BR': 'Enviar DM privada a partir de comentário', en: 'Send private reply from comment' },
    limitations: {
      'pt-BR':
        'Pode ser permitida uma única vez por comentário e apenas dentro de um prazo. Tratada como tiro único.',
      en: 'May be permitted once per comment and only within a time limit. Treated as one-shot.',
    },
    windowRequirement: 'ORIGIN_EVENT',
    idempotency: 'ONE_SHOT_GLOBAL',
    pendingQuestion: 'Q23, Q24, Q25: window length, attempts per comment, extra preconditions.',
    sandbox: { documentedLimits: { windowHours: 168, attemptsPerComment: 1 } },
  },
  {
    id: CAP.IG_RECEIVE_STORY_REPLY,
    label: { 'pt-BR': 'Receber resposta de story', en: 'Receive story reply' },
    limitations: {
      'pt-BR': 'Chega junto com mensagens; precisa ser distinguido no payload.',
      en: 'Arrives with messages; must be distinguished in the payload.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q28, Q29: how story replies arrive and whether their window differs.',
    sandbox: {},
  },
  {
    id: CAP.IG_RECEIVE_STORY_MENTION,
    label: { 'pt-BR': 'Receber menção em story', en: 'Receive story mention' },
    limitations: {
      'pt-BR': 'Chega junto com mensagens; precisa ser distinguido no payload.',
      en: 'Arrives with messages; must be distinguished in the payload.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q28: how story mentions arrive and how they differ from replies.',
    sandbox: {},
  },
  {
    id: CAP.IG_RECEIVE_LIVE_COMMENT,
    label: { 'pt-BR': 'Receber comentário em live', en: 'Receive live comment' },
    limitations: {
      'pt-BR': 'Pode ter sido descontinuado pela plataforma. Não prometa este recurso.',
      en: 'May have been discontinued by the platform. Do not promise this feature.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q13: does a live comments webhook field still exist, or was it deprecated?',
  },
  {
    id: CAP.IG_SET_ICE_BREAKERS,
    label: { 'pt-BR': 'Configurar perguntas de abertura', en: 'Configure ice breakers' },
    limitations: {
      'pt-BR': 'A quantidade máxima de perguntas é definida pelo canal.',
      en: 'The maximum number of questions is set by the channel.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q15, Q20: how many ice breakers, and whether they exist for this API path.',
  },
  {
    id: CAP.IG_READ_CONVERSATIONS,
    label: { 'pt-BR': 'Ler histórico de conversas', en: 'Read conversation history' },
    limitations: {
      'pt-BR':
        'A plataforma pode devolver detalhe só das mensagens mais recentes. O histórico do DM FLOW começa na conexão da conta.',
      en: 'The platform may return detail only for the most recent messages. DM FLOW history starts when the account is connected.',
    },
    windowRequirement: 'NONE',
    idempotency: 'NONE',
    pendingQuestion: 'Q30, Q31: how much history is retrievable, and can it predate connection?',
  },
  {
    id: CAP.IG_HUMAN_AGENT_WINDOW,
    label: { 'pt-BR': 'Estender janela para atendimento humano', en: 'Extend window for human agent' },
    limitations: {
      'pt-BR':
        'Mecanismo de exceção, restrito a resposta de agente humano. Nunca aplicar em automação.',
      en: 'Exception mechanism restricted to human agent replies. Never apply it in automation.',
    },
    windowRequirement: 'OPEN_OR_EXTENDED',
    idempotency: 'PER_EXECUTION_NODE',
    pendingQuestion: 'Q20: does a human-agent window extension exist for Instagram, and how long?',
  },
];

function buildEntry(seed: CapSeed, sandbox: boolean): CapabilityEntry {
  const simulated = sandbox && seed.sandbox !== undefined;
  return {
    id: seed.id,
    channel: 'INSTAGRAM',
    status: simulated ? 'SANDBOX_SIMULATED' : 'NOT_CONFIRMED',
    label: seed.label,
    limitations: seed.limitations,
    requiredScopes: [],
    requiredAccountTypes: [],
    windowRequirement: simulated
      ? (seed.sandbox?.windowRequirement ?? seed.windowRequirement)
      : seed.windowRequirement,
    idempotency: seed.idempotency,
    documentedLimits: simulated ? (seed.sandbox?.documentedLimits ?? {}) : {},
    doc: simulated ? SANDBOX_DOC : NOT_VALIDATED_DOC,
    pendingQuestion: seed.pendingQuestion,
  };
}

/**
 * Registry for LIVE accounts. Everything is NOT_CONFIRMED until PHASE 0 fills in
 * docs/meta-capabilities.md with a real reading of Meta's documentation. There is no
 * environment variable that flips this — validating is the only way through.
 */
export const LIVE_CAPABILITY_REGISTRY: Record<string, CapabilityEntry> = Object.fromEntries(
  IG_SEEDS.map((s) => [s.id, buildEntry(s, false)]),
);

/** Registry for SANDBOX accounts, describing what our own simulator implements. */
export const SANDBOX_CAPABILITY_REGISTRY: Record<string, CapabilityEntry> = Object.fromEntries(
  IG_SEEDS.map((s) => [s.id, buildEntry(s, true)]),
);

export function getCapabilityEntry(id: string, sandbox: boolean): CapabilityEntry | undefined {
  return sandbox ? SANDBOX_CAPABILITY_REGISTRY[id] : LIVE_CAPABILITY_REGISTRY[id];
}

export function listCapabilities(sandbox: boolean): CapabilityEntry[] {
  return Object.values(sandbox ? SANDBOX_CAPABILITY_REGISTRY : LIVE_CAPABILITY_REGISTRY);
}

// ── Decision types ───────────────────────────────────────────

export type CapabilityDenialReason =
  | 'NOT_VALIDATED'
  | 'MISSING_PERMISSION'
  | 'ACCOUNT_TYPE_UNSUPPORTED'
  | 'APP_REVIEW_REQUIRED'
  | 'ADVANCED_ACCESS_REQUIRED'
  | 'OUTSIDE_MESSAGING_WINDOW'
  | 'WINDOW_UNKNOWN'
  | 'ONE_SHOT_ALREADY_USED'
  | 'ORIGIN_EVENT_REQUIRED'
  | 'TOKEN_INVALID'
  | 'ACCOUNT_DISCONNECTED'
  | 'CONTACT_UNSUBSCRIBED'
  | 'AUTOMATION_PAUSED'
  | 'WORKSPACE_SUSPENDED'
  | 'RATE_LIMITED'
  | 'POLICY_PROHIBITED';

export interface CapabilityConstraint {
  key: string;
  value: number | string | null;
}

export type CapabilityDecision =
  | { allowed: true; capabilityId: string; constraints: CapabilityConstraint[] }
  | {
      allowed: false;
      capabilityId: string;
      reason: CapabilityDenialReason;
      userMessage: LocalizedMessage;
      remediation?: { action: string; url?: string };
      pendingQuestion?: string;
    };

export const DENIAL_MESSAGES: Record<CapabilityDenialReason, LocalizedMessage> = {
  NOT_VALIDATED: {
    'pt-BR':
      'Este recurso ainda não foi validado na documentação oficial do canal. Ele fica desativado até a validação.',
    en: 'This feature has not been validated against the channel’s official documentation yet. It stays disabled until it is.',
  },
  MISSING_PERMISSION: {
    'pt-BR': 'A conta conectada não concedeu a permissão necessária. Reconecte para conceder.',
    en: 'The connected account did not grant the required permission. Reconnect to grant it.',
  },
  ACCOUNT_TYPE_UNSUPPORTED: {
    'pt-BR': 'O tipo desta conta não suporta esta ação.',
    en: 'This account type does not support this action.',
  },
  APP_REVIEW_REQUIRED: {
    'pt-BR': 'Este recurso depende de aprovação do app junto à plataforma.',
    en: 'This feature depends on platform app approval.',
  },
  ADVANCED_ACCESS_REQUIRED: {
    'pt-BR': 'Este recurso exige acesso avançado aprovado pela plataforma.',
    en: 'This feature requires advanced access approved by the platform.',
  },
  OUTSIDE_MESSAGING_WINDOW: {
    'pt-BR':
      'A janela de mensagens com este contato está fechada. Aguarde uma nova mensagem da pessoa.',
    en: 'The messaging window with this contact is closed. Wait for them to message again.',
  },
  WINDOW_UNKNOWN: {
    'pt-BR':
      'Não foi possível confirmar a janela de mensagens, então o envio foi bloqueado por segurança.',
    en: 'The messaging window could not be confirmed, so the send was blocked for safety.',
  },
  ONE_SHOT_ALREADY_USED: {
    'pt-BR': 'Esta ação já foi usada para este alvo e não pode ser repetida.',
    en: 'This action was already used for this target and cannot be repeated.',
  },
  ORIGIN_EVENT_REQUIRED: {
    'pt-BR': 'Esta ação só funciona como resposta ao evento que iniciou a automação.',
    en: 'This action only works as a reply to the event that started the automation.',
  },
  TOKEN_INVALID: {
    'pt-BR': 'A autorização da conta expirou. Reconecte a conta.',
    en: 'The account authorization expired. Reconnect the account.',
  },
  ACCOUNT_DISCONNECTED: {
    'pt-BR': 'Esta conta não está conectada.',
    en: 'This account is not connected.',
  },
  CONTACT_UNSUBSCRIBED: {
    'pt-BR': 'Este contato pediu para não receber mensagens.',
    en: 'This contact opted out of messages.',
  },
  AUTOMATION_PAUSED: {
    'pt-BR': 'Um atendente assumiu esta conversa, então a automação está pausada aqui.',
    en: 'An agent took over this conversation, so automation is paused here.',
  },
  WORKSPACE_SUSPENDED: {
    'pt-BR': 'O workspace está suspenso por pendência no pagamento.',
    en: 'The workspace is suspended for an outstanding payment.',
  },
  RATE_LIMITED: {
    'pt-BR': 'Limite de envio atingido no momento. Vamos retomar automaticamente.',
    en: 'Send limit reached for now. We will resume automatically.',
  },
  POLICY_PROHIBITED: {
    'pt-BR': 'A política do canal não permite esta ação.',
    en: 'The channel’s policy does not permit this action.',
  },
};

export function deny(
  capabilityId: string,
  reason: CapabilityDenialReason,
  extra: { remediation?: { action: string; url?: string }; pendingQuestion?: string } = {},
): CapabilityDecision {
  return {
    allowed: false,
    capabilityId,
    reason,
    userMessage: DENIAL_MESSAGES[reason],
    remediation: extra.remediation,
    pendingQuestion: extra.pendingQuestion,
  };
}

export function allow(
  capabilityId: string,
  constraints: CapabilityConstraint[] = [],
): CapabilityDecision {
  return { allowed: true, capabilityId, constraints };
}
