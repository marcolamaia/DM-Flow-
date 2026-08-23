import {
  NODE_DEFINITIONS,
  parseNodeConfig,
  type FlowGraph,
  type FlowNode,
  type NodeType,
} from './flow.js';
import { extractTokens } from './interpolate.js';
import {
  CONNECTION_REJECTION_MESSAGES,
  findInvalidEdges,
  portsOf,
} from './ports.js';
import type { LocalizedMessage } from './locale.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  nodeId?: string;
  edgeId?: string;
  message: LocalizedMessage;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

export interface ValidationContext {
  /** Capability ids currently available for the target account. */
  availableCapabilities: Set<string>;
  /** Plan features enabled for the workspace. */
  enabledFeatures: Set<string>;
  /** Existing tag ids, so a deleted tag does not silently break a live flow. */
  tagIds: Set<string>;
  customFieldIds: Set<string>;
  /** Tokens the builder knows how to resolve, e.g. contact.displayName. */
  knownTokens: Set<string>;
  /** True when at least one trigger row is attached to this version. */
  hasTrigger: boolean;
  /** The automation being validated, so it cannot hand off to itself. */
  automationId?: string;
  /** Automations in this workspace that a handoff node may target. */
  startableAutomationIds?: Set<string>;
}

const err = (code: string, message: LocalizedMessage, nodeId?: string): ValidationIssue => ({
  severity: 'error',
  code,
  nodeId,
  message,
});

const warn = (code: string, message: LocalizedMessage, nodeId?: string): ValidationIssue => ({
  severity: 'warning',
  code,
  nodeId,
  message,
});

function outgoing(graph: FlowGraph, nodeId: string) {
  return graph.edges.filter((e) => e.source === nodeId);
}

/** Nodes reachable from the trigger, following edges forward. */
function reachableFrom(graph: FlowGraph, startId: string): Set<string> {
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const edge of outgoing(graph, current)) {
      if (!seen.has(edge.target)) {
        seen.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return seen;
}

/**
 * Cycles are only an error when they contain no delay: a loop that waits is a
 * legitimate nurture pattern, a loop that does not is an infinite send.
 */
function findDelaylessCycles(graph: FlowGraph, nodesById: Map<string, FlowNode>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];

  const visit = (nodeId: string): void => {
    const current = state.get(nodeId);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = path.indexOf(nodeId);
      if (start !== -1) {
        const cycle = path.slice(start);
        const hasDelay = cycle.some((id) => nodesById.get(id)?.type === 'delay');
        if (!hasDelay) cycles.push(cycle);
      }
      return;
    }

    state.set(nodeId, 'visiting');
    path.push(nodeId);
    for (const edge of outgoing(graph, nodeId)) visit(edge.target);
    path.pop();
    state.set(nodeId, 'done');
  };

  for (const node of graph.nodes) visit(node.id);
  return cycles;
}

/**
 * What a schema failure means to somebody using the builder.
 *
 * Zod reports the path that failed; this turns the paths a person can actually
 * fix into an instruction. Anything not listed falls back to a generic message
 * rather than leaking a schema path into the interface.
 */
function describeConfigIssue(
  type: NodeType,
  issue: { path: Array<string | number>; message: string },
): LocalizedMessage | null {
  const field = issue.path[0];

  if (field === 'tagId') {
    return { 'pt-BR': 'Escolha uma tag.', en: 'Choose a tag.' };
  }
  if (field === 'customFieldId') {
    return { 'pt-BR': 'Escolha um campo personalizado.', en: 'Choose a custom field.' };
  }
  if (field === 'automationId') {
    return { 'pt-BR': 'Escolha a automação a iniciar.', en: 'Choose the automation to start.' };
  }
  if (field === 'predicate') {
    return { 'pt-BR': 'Defina a condição.', en: 'Set the condition.' };
  }
  if (field === 'url') {
    return { 'pt-BR': 'Informe uma URL válida.', en: 'Enter a valid URL.' };
  }
  if (field === 'message') {
    return { 'pt-BR': 'Escreva a mensagem do aviso.', en: 'Write the notification message.' };
  }
  if (field === 'blocks') {
    return {
      'pt-BR': 'Escreva o texto da mensagem ou anexe uma mídia.',
      en: 'Write the message text or attach media.',
    };
  }
  if (field === 'branches') {
    return {
      'pt-BR': 'Cada caminho da ramificação precisa de uma regra.',
      en: 'Every branch path needs a rule.',
    };
  }
  if (field === 'paths' || issue.message.includes('add up to 100')) {
    return {
      'pt-BR': 'As porcentagens do randomizador precisam somar 100%.',
      en: 'The randomiser percentages must add up to 100%.',
    };
  }
  if (type === 'delay' && issue.message.includes('untilDate')) {
    return { 'pt-BR': 'Escolha a data de retomada.', en: 'Choose the date to resume on.' };
  }

  return null;
}

export function validateFlow(graph: FlowGraph, ctx: ValidationContext): ValidationReport {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // ── Structure
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    issues.push(
      err('NO_TRIGGER_NODE', {
        'pt-BR': 'O fluxo precisa de um bloco de gatilho.',
        en: 'The flow needs a trigger node.',
      }),
    );
  } else if (triggers.length > 1) {
    issues.push(
      err('MULTIPLE_TRIGGER_NODES', {
        'pt-BR': 'O fluxo deve ter apenas um bloco de gatilho.',
        en: 'The flow must have exactly one trigger node.',
      }),
    );
  }

  if (!ctx.hasTrigger) {
    issues.push(
      err('NO_TRIGGER_CONFIGURED', {
        'pt-BR': 'Configure pelo menos um gatilho antes de publicar.',
        en: 'Configure at least one trigger before publishing.',
      }),
    );
  }

  for (const edge of graph.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      issues.push({
        severity: 'error',
        code: 'DANGLING_EDGE',
        edgeId: edge.id,
        message: {
          'pt-BR': 'Existe uma conexão apontando para um bloco que não existe.',
          en: 'There is a connection pointing to a node that does not exist.',
        },
      });
    }
  }

  // A connection can stop being possible without anybody touching it: a branch
  // path gets deleted, and the edge that left it now describes a route the engine
  // will never take.
  for (const { edge, reason } of findInvalidEdges(graph)) {
    issues.push({
      severity: 'error',
      code: `INVALID_EDGE_${reason}`,
      edgeId: edge.id,
      nodeId: edge.source,
      message: CONNECTION_REJECTION_MESSAGES[reason],
    });
  }

  const trigger = triggers[0];
  if (trigger) {
    const reachable = reachableFrom(graph, trigger.id);
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issues.push(
          warn(
            'UNREACHABLE_NODE',
            {
              'pt-BR': 'Nada leva até este bloco. Ele nunca vai rodar.',
              en: 'This node cannot be reached from the trigger.',
            },
            node.id,
          ),
        );
      }
    }
  }

  for (const cycle of findDelaylessCycles(graph, nodesById)) {
    issues.push(
      err(
        'CYCLE_WITHOUT_DELAY',
        {
          'pt-BR':
            'Existe um laço sem espera neste caminho. Adicione um bloco de espera ou quebre o laço.',
          en: 'There is a loop with no delay on this path. Add a delay node or break the loop.',
        },
        cycle[0],
      ),
    );
  }

  // ── Per-node checks
  for (const node of graph.nodes) {
    const def = NODE_DEFINITIONS[node.type as NodeType];
    if (!def) {
      issues.push(
        err(
          'UNKNOWN_NODE_TYPE',
          { 'pt-BR': 'Tipo de bloco desconhecido.', en: 'Unknown node type.' },
          node.id,
        ),
      );
      continue;
    }

    const parsed = parseNodeConfig(node.type, node.config);
    if (!parsed.success) {
      // Name the setting that is wrong. "This block is incomplete" sends the
      // operator hunting through a panel; "choose a tag" is something they can
      // act on immediately.
      const missing = parsed.error.issues
        .map((issue) => describeConfigIssue(node.type as NodeType, issue))
        .filter((entry, index, all): entry is LocalizedMessage => {
          if (!entry) return false;
          return all.findIndex((other) => other?.['pt-BR'] === entry['pt-BR']) === index;
        });

      issues.push(
        err(
          'NODE_CONFIG_INVALID',
          missing.length > 0
            ? {
                'pt-BR': missing.map((entry) => entry['pt-BR']).join(' · '),
                en: missing.map((entry) => entry.en).join(' · '),
              }
            : {
                'pt-BR': 'A configuração deste bloco está incompleta ou inválida.',
                en: 'This block’s configuration is incomplete or invalid.',
              },
          node.id,
        ),
      );
    }

    for (const capability of def.requiredCapabilities) {
      if (!ctx.availableCapabilities.has(capability)) {
        issues.push(
          err(
            'CAPABILITY_UNAVAILABLE',
            {
              'pt-BR':
                'Este node depende de um recurso do canal que não está disponível ou validado.',
              en: 'This node depends on a channel feature that is unavailable or unvalidated.',
            },
            node.id,
          ),
        );
      }
    }

    if (def.requiredFeature && !ctx.enabledFeatures.has(def.requiredFeature)) {
      issues.push(
        err(
          'FEATURE_NOT_IN_PLAN',
          {
            'pt-BR': 'Este bloco não está incluído no seu plano atual.',
            en: 'This node is not included in your current plan.',
          },
          node.id,
        ),
      );
    }

    // Exits are checked against the node's declared ports rather than a list of
    // special cases, so a new node type with several paths is covered the day it
    // is added instead of the day somebody remembers to extend this function.
    const ports = portsOf(node);
    const connectedHandles = new Set(outgoing(graph, node.id).map((e) => e.sourceHandle ?? null));

    for (const port of ports.outputs) {
      if (connectedHandles.has(port.id)) continue;

      // A fallback path left open is a deliberate "stop here if nothing matched",
      // not a mistake — so it is worth pointing out, but it never blocks.
      issues.push(
        port.fallback
          ? warn(
              'FALLBACK_PORT_NOT_CONNECTED',
              {
                'pt-BR': `A saída "${port.label['pt-BR']}" não leva a lugar nenhum. Quem cair nela sai da automação.`,
                en: `The "${port.label.en}" exit leads nowhere. Anyone landing there leaves the automation.`,
              },
              node.id,
            )
          : ports.outputs.length > 1
            ? err(
                'PORT_NOT_CONNECTED',
                {
                  'pt-BR': `A saída "${port.label['pt-BR']}" deste bloco não está ligada a nada.`,
                  en: `This block's "${port.label.en}" exit is not connected to anything.`,
                },
                node.id,
              )
            : warn(
                'NODE_HAS_NO_EXIT',
                {
                  'pt-BR': 'Este bloco não leva a lugar nenhum. A execução termina aqui.',
                  en: 'This block leads nowhere. The execution ends here.',
                },
                node.id,
              ),
      );
    }

    if (node.type === 'start_automation' && parsed.success) {
      const { automationId } = parsed.data as { automationId: string };

      if (ctx.automationId && automationId === ctx.automationId) {
        issues.push(
          err(
            'START_AUTOMATION_SELF',
            {
              'pt-BR': 'Uma automação não pode iniciar ela mesma. Escolha outra.',
              en: 'An automation cannot start itself. Pick a different one.',
            },
            node.id,
          ),
        );
      } else if (ctx.startableAutomationIds && !ctx.startableAutomationIds.has(automationId)) {
        issues.push(
          err(
            'START_AUTOMATION_NOT_FOUND',
            {
              'pt-BR': 'A automação escolhida neste bloco não existe mais.',
              en: 'The automation chosen in this block no longer exists.',
            },
            node.id,
          ),
        );
      }
    }

    if ((node.type === 'add_tag' || node.type === 'remove_tag') && parsed.success) {
      const { tagId } = parsed.data as { tagId: string };
      if (!ctx.tagIds.has(tagId)) {
        issues.push(
          err(
            'TAG_NOT_FOUND',
            {
              'pt-BR': 'A tag usada neste bloco não existe mais.',
              en: 'The tag used by this node no longer exists.',
            },
            node.id,
          ),
        );
      }
    }

    if (
      (node.type === 'set_custom_field' || node.type === 'clear_custom_field') &&
      parsed.success
    ) {
      const { customFieldId } = parsed.data as { customFieldId: string };
      if (!ctx.customFieldIds.has(customFieldId)) {
        issues.push(
          err(
            'CUSTOM_FIELD_NOT_FOUND',
            {
              'pt-BR': 'O campo personalizado usado neste bloco não existe mais.',
              en: 'The custom field used by this node no longer exists.',
            },
            node.id,
          ),
        );
      }
    }

    if (node.type === 'send_message' && parsed.success) {
      const config = parsed.data as { blocks: Array<{ type: string; text?: string }> };
      for (const block of config.blocks) {
        if (block.type !== 'text' || !block.text) continue;
        for (const token of extractTokens(block.text)) {
          if (!ctx.knownTokens.has(token)) {
            issues.push(
              warn(
                'UNKNOWN_TOKEN',
                {
                  'pt-BR': `A variável {{${token}}} pode não ter valor e sairá em branco.`,
                  en: `The variable {{${token}}} may have no value and will render empty.`,
                },
                node.id,
              ),
            );
          }
        }
      }
    }
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
    checkedAt: new Date().toISOString(),
  };
}

/** Tokens the engine always provides, used by the builder to avoid false warnings. */
export const BUILTIN_TOKENS = [
  'contact.displayName',
  'contact.username',
  'contact.id',
  'contact.locale',
  'workspace.name',
  'trigger.text',
  'trigger.type',
] as const;
