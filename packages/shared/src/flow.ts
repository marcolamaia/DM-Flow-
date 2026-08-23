import { z } from 'zod';
import { predicateSchema } from './predicate.js';
import { CAP } from './capabilities.js';
import type { LocalizedMessage } from './locale.js';

/**
 * The persisted flow graph is OUR schema, versioned independently of whatever
 * canvas library the frontend uses. Swapping React Flow must not invalidate a
 * customer's saved automations.
 */
export const FLOW_SCHEMA_VERSION = 1;

export const NODE_TYPES = [
  'trigger',
  'send_message',
  'condition',
  'branch',
  'randomizer',
  'wait_for_reply',
  'delay',
  'add_tag',
  'remove_tag',
  'set_custom_field',
  'clear_custom_field',
  'http_request',
  'assign_conversation',
  'set_conversation_status',
  'notify_team',
  'unsubscribe_contact',
  'start_automation',
  'end',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

// ── Message content ──────────────────────────────────────────

export const quickReplySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(64),
});

export const messageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('image'),
    url: z.string().url().max(2000),
    caption: z.string().max(1000).optional(),
  }),
  z.object({ type: z.literal('video'), url: z.string().url().max(2000) }),
  z.object({ type: z.literal('audio'), url: z.string().url().max(2000) }),
]);
export type MessageBlock = z.infer<typeof messageBlockSchema>;

// ── Node configs ─────────────────────────────────────────────

export const triggerNodeConfig = z.object({
  /** Trigger rows live in their own table; the node only anchors the entry point. */
  label: z.string().max(120).optional(),
});

export const sendMessageConfig = z.object({
  blocks: z.array(messageBlockSchema).min(1).max(5),
  quickReplies: z.array(quickReplySchema).max(13).default([]),
  /** When true the node uses the origin comment to send a private reply. */
  asPrivateReply: z.boolean().default(false),
});

export const conditionConfig = z.object({
  predicate: predicateSchema,
});

export const branchConfig = z.object({
  branches: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().max(120),
        predicate: predicateSchema,
      }),
    )
    .min(1)
    .max(10),
});

/**
 * Waits for the contact to answer, and routes on what they said.
 *
 * Every option becomes its own exit, which is what makes a message with buttons
 * a real fork in the flow rather than a decoration. Two ways to recognise an
 * answer, deliberately separate:
 *
 * - `quick_reply` routes on the identifier of the button that was tapped. That
 *   requires the channel to deliver such an identifier, which is a capability of
 *   its own — receiving the message does not imply knowing which button caused it.
 * - `keywords` routes on what the contact typed, which works on any channel that
 *   delivers inbound text.
 */
export const waitForReplyConfig = z.object({
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(60),
        match: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('quick_reply'), payload: z.string().min(1).max(64) }),
          z.object({
            kind: z.literal('keywords'),
            keywords: z.array(z.string().min(1).max(60)).min(1).max(20),
          }),
        ]),
      }),
    )
    .max(13)
    .default([]),
  /**
   * How long to wait before giving up.
   *
   * Required, and capped: an execution parked forever holds a contact inside a
   * flow nobody can see, and no amount of waiting makes a silent contact answer.
   */
  timeoutAmount: z.number().int().min(1).max(60).default(1),
  timeoutUnit: z.enum(['minutes', 'hours', 'days']).default('days'),
});

export const randomizerConfig = z
  .object({
    paths: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          label: z.string().max(60).default(''),
          /** Whole percent. Kept as an integer so the total is exact, never 99.99. */
          weight: z.number().int().min(0).max(100),
        }),
      )
      .min(2)
      .max(10),
  })
  .refine((v) => v.paths.reduce((total, path) => total + path.weight, 0) === 100, {
    message: 'weights must add up to 100',
  });

export const startAutomationConfig = z.object({
  automationId: z.string().min(1),
  /**
   * Whether this run stops once the other automation is started.
   *
   * Handing the contact over and also carrying on down this flow means two
   * automations messaging the same person at once, so the choice has to be
   * deliberate rather than implied.
   */
  stopCurrent: z.boolean().default(true),
});

export const delayConfig = z
  .object({
    mode: z.enum(['duration', 'until_date']).default('duration'),
    amount: z.number().int().min(1).max(3650).default(1),
    unit: z.enum(['minutes', 'hours', 'days']).default('hours'),
    untilDate: z.string().datetime().optional(),
    /** Only resume inside this local window, e.g. 08:00–22:00 workspace time. */
    resumeWindow: z
      .object({
        enabled: z.boolean().default(false),
        startHour: z.number().int().min(0).max(23).default(8),
        endHour: z.number().int().min(0).max(23).default(22),
      })
      .default({ enabled: false, startHour: 8, endHour: 22 }),
  })
  .refine((v) => v.mode !== 'until_date' || Boolean(v.untilDate), {
    message: 'untilDate is required when mode is until_date',
  });

export const addTagConfig = z.object({ tagId: z.string().min(1) });
export const removeTagConfig = z.object({ tagId: z.string().min(1) });

export const setCustomFieldConfig = z.object({
  customFieldId: z.string().min(1),
  /** Supports {{contact.displayName}} style interpolation. */
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
});
export const clearCustomFieldConfig = z.object({ customFieldId: z.string().min(1) });

export const httpRequestConfig = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().url().max(2000),
  headers: z.record(z.string().max(200)).default({}),
  body: z.string().max(20_000).optional(),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  /** Store the parsed JSON response under this execution variable. */
  saveAs: z.string().max(64).optional(),
});

export const assignConversationConfig = z.object({
  assigneeId: z.string().min(1).nullable(),
});

export const setConversationStatusConfig = z.object({
  status: z.enum(['OPEN', 'SNOOZED', 'CLOSED']),
  snoozeMinutes: z.number().int().min(1).max(43_200).optional(),
});

export const notifyTeamConfig = z.object({
  message: z.string().min(1).max(500),
  memberIds: z.array(z.string()).max(50).default([]),
});

export const emptyConfig = z.object({}).passthrough();

export const NODE_CONFIG_SCHEMAS: Record<NodeType, z.ZodTypeAny> = {
  trigger: triggerNodeConfig,
  send_message: sendMessageConfig,
  condition: conditionConfig,
  branch: branchConfig,
  randomizer: randomizerConfig,
  wait_for_reply: waitForReplyConfig,
  delay: delayConfig,
  add_tag: addTagConfig,
  remove_tag: removeTagConfig,
  set_custom_field: setCustomFieldConfig,
  clear_custom_field: clearCustomFieldConfig,
  http_request: httpRequestConfig,
  assign_conversation: assignConversationConfig,
  set_conversation_status: setConversationStatusConfig,
  notify_team: notifyTeamConfig,
  unsubscribe_contact: emptyConfig,
  start_automation: startAutomationConfig,
  end: emptyConfig,
};

// ── Graph ────────────────────────────────────────────────────

export const flowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }),
  config: z.record(z.unknown()).default({}),
  label: z.string().max(120).optional(),
});
export type FlowNode = z.infer<typeof flowNodeSchema>;

export const flowEdgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  /** 'true' | 'false' for condition nodes; branch id for branch nodes. */
  sourceHandle: z.string().max(64).nullable().default(null),
  label: z.string().max(120).optional(),
});
export type FlowEdge = z.infer<typeof flowEdgeSchema>;

export const flowGraphSchema = z.object({
  schemaVersion: z.number().int().min(1).default(FLOW_SCHEMA_VERSION),
  nodes: z.array(flowNodeSchema).max(300),
  edges: z.array(flowEdgeSchema).max(600),
});
export type FlowGraph = z.infer<typeof flowGraphSchema>;

export function emptyGraph(): FlowGraph {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 240, y: 80 },
        config: {},
        label: 'Início',
      },
    ],
    edges: [],
  };
}

// ── Node metadata for the builder palette ────────────────────

export interface NodeDefinition {
  type: NodeType;
  label: LocalizedMessage;
  description: LocalizedMessage;
  category: 'trigger' | 'message' | 'logic' | 'data' | 'integration' | 'inbox' | 'terminal';
  /** Capability ids that must be available for this node to be offered. */
  requiredCapabilities: string[];
  /** Feature flag gate from the workspace plan, if any. */
  requiredFeature?: string;
  /**
   * Connection points are NOT declared here. They come from portsOf() in
   * ./ports, which is the single answer the canvas, the validator and the engine
   * all read — a node type describing its own ports in two places is how the
   * branch node ended up with none drawn at all.
   */
  terminal: boolean;
}

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  trigger: {
    type: 'trigger',
    label: { 'pt-BR': 'Gatilho', en: 'Trigger' },
    description: {
      'pt-BR': 'Ponto de entrada. Define o que inicia esta automação.',
      en: 'Entry point. Defines what starts this automation.',
    },
    category: 'trigger',
    requiredCapabilities: [],
    terminal: false,
  },
  send_message: {
    type: 'send_message',
    label: { 'pt-BR': 'Enviar mensagem', en: 'Send message' },
    description: {
      'pt-BR': 'Envia uma mensagem ao contato pelo canal da conversa.',
      en: 'Sends a message to the contact on the conversation’s channel.',
    },
    category: 'message',
    requiredCapabilities: [CAP.IG_SEND_TEXT],
    terminal: false,
  },
  condition: {
    type: 'condition',
    label: { 'pt-BR': 'Condição', en: 'Condition' },
    description: {
      'pt-BR': 'Divide o fluxo entre dois caminhos conforme uma regra.',
      en: 'Splits the flow into two paths based on a rule.',
    },
    category: 'logic',
    requiredCapabilities: [],
    terminal: false,
  },
  branch: {
    type: 'branch',
    label: { 'pt-BR': 'Ramificação', en: 'Branch' },
    description: {
      'pt-BR': 'Divide o fluxo em vários caminhos, avaliados em ordem.',
      en: 'Splits the flow into several paths, evaluated in order.',
    },
    category: 'logic',
    requiredCapabilities: [],
    terminal: false,
  },
  randomizer: {
    type: 'randomizer',
    label: { 'pt-BR': 'Randomizador', en: 'Randomizer' },
    description: {
      'pt-BR': 'Distribui os contatos entre vários caminhos por porcentagem.',
      en: 'Splits contacts across several paths by percentage.',
    },
    category: 'logic',
    requiredCapabilities: [],
    terminal: false,
  },
  wait_for_reply: {
    type: 'wait_for_reply',
    label: { 'pt-BR': 'Aguardar resposta', en: 'Wait for reply' },
    description: {
      'pt-BR': 'Espera o contato responder e segue por um caminho diferente para cada resposta.',
      en: 'Waits for the contact to answer and takes a different path for each answer.',
    },
    category: 'logic',
    // Receiving the reply at all is the floor. Routing by which button was tapped
    // needs a second capability, checked per option when the flow is validated —
    // an option that needs it is refused, not the whole block.
    requiredCapabilities: [CAP.IG_RECEIVE_DM],
    terminal: false,
  },
  delay: {
    type: 'delay',
    label: { 'pt-BR': 'Espera', en: 'Delay' },
    description: {
      'pt-BR': 'Pausa a execução e retoma depois, no horário permitido.',
      en: 'Pauses the execution and resumes later, inside permitted hours.',
    },
    category: 'logic',
    requiredCapabilities: [],
    terminal: false,
  },
  add_tag: {
    type: 'add_tag',
    label: { 'pt-BR': 'Adicionar tag', en: 'Add tag' },
    description: {
      'pt-BR': 'Aplica uma tag ao contato.',
      en: 'Applies a tag to the contact.',
    },
    category: 'data',
    requiredCapabilities: [],
    terminal: false,
  },
  remove_tag: {
    type: 'remove_tag',
    label: { 'pt-BR': 'Remover tag', en: 'Remove tag' },
    description: {
      'pt-BR': 'Remove uma tag do contato.',
      en: 'Removes a tag from the contact.',
    },
    category: 'data',
    requiredCapabilities: [],
    terminal: false,
  },
  set_custom_field: {
    type: 'set_custom_field',
    label: { 'pt-BR': 'Definir campo', en: 'Set field' },
    description: {
      'pt-BR': 'Grava um valor em um campo personalizado do contato.',
      en: 'Writes a value into a contact custom field.',
    },
    category: 'data',
    requiredCapabilities: [],
    terminal: false,
  },
  clear_custom_field: {
    type: 'clear_custom_field',
    label: { 'pt-BR': 'Limpar campo', en: 'Clear field' },
    description: {
      'pt-BR': 'Apaga o valor de um campo personalizado.',
      en: 'Clears a custom field value.',
    },
    category: 'data',
    requiredCapabilities: [],
    terminal: false,
  },
  http_request: {
    type: 'http_request',
    label: { 'pt-BR': 'Requisição HTTP', en: 'HTTP request' },
    description: {
      'pt-BR': 'Chama um sistema externo e guarda a resposta em uma variável.',
      en: 'Calls an external system and stores the response in a variable.',
    },
    category: 'integration',
    requiredCapabilities: [],
    requiredFeature: 'http_request_node',
    terminal: false,
  },
  assign_conversation: {
    type: 'assign_conversation',
    label: { 'pt-BR': 'Atribuir conversa', en: 'Assign conversation' },
    description: {
      'pt-BR': 'Encaminha a conversa para um membro do time.',
      en: 'Routes the conversation to a team member.',
    },
    category: 'inbox',
    requiredCapabilities: [],
    terminal: false,
  },
  set_conversation_status: {
    type: 'set_conversation_status',
    label: { 'pt-BR': 'Status da conversa', en: 'Conversation status' },
    description: {
      'pt-BR': 'Marca a conversa como aberta, adiada ou fechada.',
      en: 'Marks the conversation open, snoozed or closed.',
    },
    category: 'inbox',
    requiredCapabilities: [],
    terminal: false,
  },
  notify_team: {
    type: 'notify_team',
    label: { 'pt-BR': 'Notificar time', en: 'Notify team' },
    description: {
      'pt-BR': 'Avisa membros do time sobre esta conversa.',
      en: 'Alerts team members about this conversation.',
    },
    category: 'inbox',
    requiredCapabilities: [],
    terminal: false,
  },
  unsubscribe_contact: {
    type: 'unsubscribe_contact',
    label: { 'pt-BR': 'Descadastrar contato', en: 'Unsubscribe contact' },
    description: {
      'pt-BR': 'Marca o contato como descadastrado. Nenhum envio ocorre depois disso.',
      en: 'Marks the contact unsubscribed. No sends happen after this.',
    },
    category: 'data',
    requiredCapabilities: [],
    terminal: false,
  },
  start_automation: {
    type: 'start_automation',
    label: { 'pt-BR': 'Iniciar automação', en: 'Start automation' },
    description: {
      'pt-BR': 'Entrega o contato para outra automação, sem duplicar o fluxo dela aqui.',
      en: 'Hands the contact to another automation, without duplicating its flow here.',
    },
    category: 'logic',
    requiredCapabilities: [],
    terminal: false,
  },
  end: {
    type: 'end',
    label: { 'pt-BR': 'Fim', en: 'End' },
    description: {
      'pt-BR': 'Encerra a execução com sucesso.',
      en: 'Ends the execution successfully.',
    },
    category: 'terminal',
    requiredCapabilities: [],
    terminal: true,
  },
};

/**
 * What a node holds the moment it is created.
 *
 * Nodes whose exits come from their own configuration must arrive with some — a
 * randomiser with no paths has no exits at all, so it lands on the canvas as a
 * dead end nothing can be connected to. The defaults are the smallest shape that
 * is still useful and still adds up.
 */
export function defaultNodeConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case 'send_message':
      return { blocks: [{ type: 'text', text: '' }], quickReplies: [], asPrivateReply: false };
    case 'branch':
      return { branches: [{ id: 'p1', label: '', predicate: null }] };
    case 'randomizer':
      return {
        paths: [
          { id: 'a', label: 'A', weight: 50 },
          { id: 'b', label: 'B', weight: 50 },
        ],
      };
    case 'wait_for_reply':
      return { options: [], timeoutAmount: 1, timeoutUnit: 'days' };
    case 'delay':
      return {
        mode: 'duration',
        amount: 1,
        unit: 'hours',
        resumeWindow: { enabled: false, startHour: 8, endHour: 22 },
      };
    case 'http_request':
      return { method: 'GET', url: '', headers: {}, timeoutMs: 10_000 };
    case 'set_conversation_status':
      return { status: 'OPEN' };
    case 'start_automation':
      return { automationId: '', stopCurrent: true };
    default:
      return {};
  }
}

export function parseNodeConfig(type: NodeType, config: unknown) {
  return NODE_CONFIG_SCHEMAS[type].safeParse(config ?? {});
}
