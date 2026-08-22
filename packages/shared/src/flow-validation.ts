import {
  NODE_DEFINITIONS,
  parseNodeConfig,
  type FlowGraph,
  type FlowNode,
  type NodeType,
} from './flow.js';
import { extractTokens } from './interpolate.js';
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

export function validateFlow(graph: FlowGraph, ctx: ValidationContext): ValidationReport {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // ── Structure
  const triggers = graph.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length === 0) {
    issues.push(
      err('NO_TRIGGER_NODE', {
        'pt-BR': 'O fluxo precisa de um node de gatilho.',
        en: 'The flow needs a trigger node.',
      }),
    );
  } else if (triggers.length > 1) {
    issues.push(
      err('MULTIPLE_TRIGGER_NODES', {
        'pt-BR': 'O fluxo deve ter apenas um node de gatilho.',
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
          'pt-BR': 'Existe uma conexão apontando para um node que não existe.',
          en: 'There is a connection pointing to a node that does not exist.',
        },
      });
    }
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
              'pt-BR': 'Este node não é alcançável a partir do gatilho.',
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
            'Existe um laço sem espera neste caminho. Adicione um node de espera ou quebre o laço.',
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
          { 'pt-BR': 'Tipo de node desconhecido.', en: 'Unknown node type.' },
          node.id,
        ),
      );
      continue;
    }

    const parsed = parseNodeConfig(node.type, node.config);
    if (!parsed.success) {
      issues.push(
        err(
          'NODE_CONFIG_INVALID',
          {
            'pt-BR': 'A configuração deste node está incompleta ou inválida.',
            en: 'This node’s configuration is incomplete or invalid.',
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
            'pt-BR': 'Este node não está incluído no seu plano atual.',
            en: 'This node is not included in your current plan.',
          },
          node.id,
        ),
      );
    }

    if (!def.terminal && node.type !== 'condition' && node.type !== 'branch') {
      if (outgoing(graph, node.id).length === 0) {
        issues.push(
          warn(
            'NODE_HAS_NO_EXIT',
            {
              'pt-BR': 'Este node não leva a lugar nenhum. A execução termina aqui.',
              en: 'This node leads nowhere. The execution ends here.',
            },
            node.id,
          ),
        );
      }
    }

    if (node.type === 'condition') {
      const handles = new Set(outgoing(graph, node.id).map((e) => e.sourceHandle));
      if (!handles.has('true') || !handles.has('false')) {
        issues.push(
          err(
            'CONDITION_MISSING_BRANCH',
            {
              'pt-BR': 'Uma condição precisa dos dois caminhos ligados: verdadeiro e falso.',
              en: 'A condition needs both paths connected: true and false.',
            },
            node.id,
          ),
        );
      }
    }

    if (node.type === 'branch' && parsed.success) {
      const config = parsed.data as { branches: Array<{ id: string }> };
      const connected = new Set(outgoing(graph, node.id).map((e) => e.sourceHandle));
      for (const branch of config.branches) {
        if (!connected.has(branch.id)) {
          issues.push(
            err(
              'BRANCH_NOT_CONNECTED',
              {
                'pt-BR': 'Um caminho da ramificação não está conectado.',
                en: 'A branch path is not connected.',
              },
              node.id,
            ),
          );
        }
      }
    }

    if ((node.type === 'add_tag' || node.type === 'remove_tag') && parsed.success) {
      const { tagId } = parsed.data as { tagId: string };
      if (!ctx.tagIds.has(tagId)) {
        issues.push(
          err(
            'TAG_NOT_FOUND',
            {
              'pt-BR': 'A tag usada neste node não existe mais.',
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
              'pt-BR': 'O campo personalizado usado neste node não existe mais.',
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
