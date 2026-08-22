import { z } from 'zod';
import { CAP } from './capabilities.js';
import type { Channel } from './capabilities.js';
import type { LocalizedMessage } from './locale.js';

export const TRIGGER_TYPES = [
  // Layer 1 — fully ours, no external dependency
  'manual_enrollment',
  'contact_tag_added',
  'inbound_api',
  // Layer 2 — channel events
  'ig_dm_keyword',
  'ig_dm_default',
  'ig_comment',
  'ig_story_reply',
  'ig_story_mention',
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

const keywordMatchConfig = z.object({
  /** Empty include list means "any message". */
  includeKeywords: z.array(z.string().min(1).max(80)).max(50).default([]),
  excludeKeywords: z.array(z.string().min(1).max(80)).max(50).default([]),
  matchMode: z.enum(['contains', 'exact', 'starts_with']).default('contains'),
  caseSensitive: z.boolean().default(false),
});

export const TRIGGER_CONFIG_SCHEMAS = {
  manual_enrollment: z.object({}).passthrough(),
  contact_tag_added: z.object({ tagId: z.string().min(1) }),
  inbound_api: z.object({ key: z.string().min(3).max(64) }),
  ig_dm_keyword: keywordMatchConfig,
  ig_dm_default: z.object({}).passthrough(),
  ig_comment: keywordMatchConfig.extend({
    /** Empty means every post/reel on the connected account. */
    mediaIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    replyPublicly: z.boolean().default(false),
    publicReplyText: z.string().max(500).optional(),
  }),
  ig_story_reply: keywordMatchConfig,
  ig_story_mention: z.object({}).passthrough(),
} as const satisfies Record<TriggerType, z.ZodTypeAny>;

export interface TriggerDefinition {
  type: TriggerType;
  channel: Channel | null;
  label: LocalizedMessage;
  description: LocalizedMessage;
  requiredCapabilities: string[];
  /**
   * Exact webhook field this trigger listens to. Empty string means PHASE 0 has not
   * confirmed the field name yet — never guess one here.
   */
  sourceWebhookField: string;
  limitations: LocalizedMessage;
  /** Higher wins when two triggers match the same event. */
  defaultPriority: number;
  /** Catch-all triggers only fire when nothing more specific matched. */
  isCatchAll: boolean;
}

export const TRIGGER_DEFINITIONS: Record<TriggerType, TriggerDefinition> = {
  manual_enrollment: {
    type: 'manual_enrollment',
    channel: null,
    label: { 'pt-BR': 'Inscrição manual', en: 'Manual enrollment' },
    description: {
      'pt-BR': 'Você coloca contatos nesta automação manualmente.',
      en: 'You enroll contacts into this automation by hand.',
    },
    requiredCapabilities: [],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Nenhuma. Funciona sem canal conectado.',
      en: 'None. Works with no channel connected.',
    },
    defaultPriority: 100,
    isCatchAll: false,
  },
  contact_tag_added: {
    type: 'contact_tag_added',
    channel: null,
    label: { 'pt-BR': 'Tag aplicada ao contato', en: 'Tag applied to contact' },
    description: {
      'pt-BR': 'Dispara quando uma tag específica é aplicada a um contato.',
      en: 'Fires when a specific tag is applied to a contact.',
    },
    requiredCapabilities: [],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Nenhuma. Evento interno.',
      en: 'None. Internal event.',
    },
    defaultPriority: 90,
    isCatchAll: false,
  },
  inbound_api: {
    type: 'inbound_api',
    channel: null,
    label: { 'pt-BR': 'Chamada de API', en: 'API call' },
    description: {
      'pt-BR': 'Um sistema externo chama a DM FLOW para iniciar esta automação.',
      en: 'An external system calls DM FLOW to start this automation.',
    },
    requiredCapabilities: [],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Exige uma chave de API do workspace.',
      en: 'Requires a workspace API key.',
    },
    defaultPriority: 80,
    isCatchAll: false,
  },
  ig_dm_keyword: {
    type: 'ig_dm_keyword',
    channel: 'INSTAGRAM',
    label: { 'pt-BR': 'Palavra-chave na DM', en: 'DM keyword' },
    description: {
      'pt-BR': 'Dispara quando a mensagem recebida contém uma das palavras-chave.',
      en: 'Fires when an incoming message contains one of the keywords.',
    },
    requiredCapabilities: [CAP.IG_RECEIVE_DM],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'A resposta só sai dentro da janela de mensagens do canal.',
      en: 'The reply only goes out inside the channel’s messaging window.',
    },
    defaultPriority: 70,
    isCatchAll: false,
  },
  ig_dm_default: {
    type: 'ig_dm_default',
    channel: 'INSTAGRAM',
    label: { 'pt-BR': 'Resposta padrão da DM', en: 'DM default reply' },
    description: {
      'pt-BR': 'Captura qualquer mensagem que não deu match em nenhum outro gatilho.',
      en: 'Catches any message that matched no other trigger.',
    },
    requiredCapabilities: [CAP.IG_RECEIVE_DM],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Só dispara quando nenhum gatilho específico casou.',
      en: 'Only fires when no specific trigger matched.',
    },
    defaultPriority: 0,
    isCatchAll: true,
  },
  ig_comment: {
    type: 'ig_comment',
    channel: 'INSTAGRAM',
    label: { 'pt-BR': 'Comentário em post ou reel', en: 'Post or reel comment' },
    description: {
      'pt-BR': 'Dispara quando alguém comenta, e permite responder em privado.',
      en: 'Fires when someone comments, and can reply privately.',
    },
    requiredCapabilities: [CAP.IG_RECEIVE_COMMENT],
    sourceWebhookField: '',
    limitations: {
      'pt-BR':
        'A resposta privada pode ser permitida uma única vez por comentário e dentro de um prazo. É tratada como tiro único.',
      en: 'The private reply may be allowed once per comment and within a time limit. It is treated as one-shot.',
    },
    defaultPriority: 75,
    isCatchAll: false,
  },
  ig_story_reply: {
    type: 'ig_story_reply',
    channel: 'INSTAGRAM',
    label: { 'pt-BR': 'Resposta a story', en: 'Story reply' },
    description: {
      'pt-BR': 'Dispara quando alguém responde a um story da conta.',
      en: 'Fires when someone replies to one of the account’s stories.',
    },
    requiredCapabilities: [CAP.IG_RECEIVE_STORY_REPLY],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Chega junto com as mensagens e precisa ser distinguido no payload.',
      en: 'Arrives alongside messages and must be distinguished in the payload.',
    },
    defaultPriority: 72,
    isCatchAll: false,
  },
  ig_story_mention: {
    type: 'ig_story_mention',
    channel: 'INSTAGRAM',
    label: { 'pt-BR': 'Menção em story', en: 'Story mention' },
    description: {
      'pt-BR': 'Dispara quando alguém menciona a conta no story dela.',
      en: 'Fires when someone mentions the account in their story.',
    },
    requiredCapabilities: [CAP.IG_RECEIVE_STORY_MENTION],
    sourceWebhookField: '',
    limitations: {
      'pt-BR': 'Chega junto com as mensagens e precisa ser distinguido no payload.',
      en: 'Arrives alongside messages and must be distinguished in the payload.',
    },
    defaultPriority: 71,
    isCatchAll: false,
  },
};

export function parseTriggerConfig(type: TriggerType, config: unknown) {
  return TRIGGER_CONFIG_SCHEMAS[type].safeParse(config ?? {});
}

export interface KeywordMatchConfig {
  includeKeywords: string[];
  excludeKeywords: string[];
  matchMode: 'contains' | 'exact' | 'starts_with';
  caseSensitive: boolean;
}

/** Shared keyword matching so DM, comment and story triggers behave identically. */
export function matchesKeywords(text: string, config: KeywordMatchConfig): boolean {
  const haystack = config.caseSensitive ? text : text.toLowerCase();
  const normalize = (k: string) => (config.caseSensitive ? k : k.toLowerCase());

  for (const excluded of config.excludeKeywords) {
    if (haystack.includes(normalize(excluded))) return false;
  }

  // No include keywords means "any message that survived the exclusions".
  if (config.includeKeywords.length === 0) return true;

  return config.includeKeywords.some((keyword) => {
    const needle = normalize(keyword);
    switch (config.matchMode) {
      case 'exact':
        return haystack.trim() === needle;
      case 'starts_with':
        return haystack.trimStart().startsWith(needle);
      case 'contains':
      default:
        return haystack.includes(needle);
    }
  });
}
