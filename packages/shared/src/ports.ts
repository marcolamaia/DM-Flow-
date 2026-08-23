import type { LocalizedMessage } from './locale.js';
import type { FlowEdge, FlowGraph, FlowNode, NodeType } from './flow.js';

/**
 * A node's connection points, described rather than assumed.
 *
 * The builder used to hard-code a single list of handle names for one node type,
 * which is why the branch node — the whole point of which is several paths — had
 * no ports drawn at all and could never be published. Describing the ports here,
 * next to the node's schema, means the canvas, the validator and the engine all
 * read the same answer instead of three separate guesses.
 */
export interface PortDefinition {
  /** Matches FlowEdge.sourceHandle. `null` is the single unnamed exit. */
  id: string | null;
  label: LocalizedMessage;
  /**
   * How many edges may leave this port.
   *
   * Almost always 1. The engine follows exactly one edge per port, so allowing a
   * second one means quietly discarding it — the operator draws two paths and
   * only one ever runs.
   */
  maxConnections: number;
  /** Marks the port that runs when nothing else matched, for clearer drawing. */
  fallback?: boolean;
  /** Ports whose count comes from the node's own configuration. */
  dynamic?: boolean;
}

export interface PortLayout {
  /** Whether anything may connect *into* this node. */
  acceptsInput: boolean;
  /**
   * How many edges may arrive. Several nodes converging on one step is normal and
   * useful — two branches leading to the same closing message — so this is
   * unbounded unless a node type says otherwise.
   */
  maxInputs: number;
  outputs: PortDefinition[];
}

const YES: LocalizedMessage = { 'pt-BR': 'Sim', en: 'Yes' };
const NO: LocalizedMessage = { 'pt-BR': 'Não', en: 'No' };
const NEXT: LocalizedMessage = { 'pt-BR': 'Próximo', en: 'Next' };
const OTHERWISE: LocalizedMessage = { 'pt-BR': 'Nenhuma acima', en: 'None of the above' };

/** The ordinary shape: one way in, one way on. */
const SEQUENTIAL: PortLayout = {
  acceptsInput: true,
  maxInputs: Number.POSITIVE_INFINITY,
  outputs: [{ id: null, label: NEXT, maxConnections: 1 }],
};

const TERMINAL: PortLayout = {
  acceptsInput: true,
  maxInputs: Number.POSITIVE_INFINITY,
  outputs: [],
};

const STATIC_LAYOUTS: Partial<Record<NodeType, PortLayout>> = {
  // Nothing may connect into the trigger: it is where a run begins, and an edge
  // arriving there would describe a path that can never be taken.
  trigger: {
    acceptsInput: false,
    maxInputs: 0,
    outputs: [{ id: null, label: NEXT, maxConnections: 1 }],
  },
  condition: {
    acceptsInput: true,
    maxInputs: Number.POSITIVE_INFINITY,
    outputs: [
      { id: 'true', label: YES, maxConnections: 1 },
      { id: 'false', label: NO, maxConnections: 1 },
    ],
  },
  end: TERMINAL,
  unsubscribe_contact: TERMINAL,
};

/**
 * Reads the ports a node actually has, including the ones that come from its own
 * configuration — a branch node's paths, a randomiser's slices.
 */
export function portsOf(node: Pick<FlowNode, 'type' | 'config'>): PortLayout {
  const stat = STATIC_LAYOUTS[node.type as NodeType];
  if (stat) return stat;

  if (node.type === 'branch') {
    const branches = (node.config?.branches ?? []) as Array<{ id: string; label?: string }>;
    return {
      acceptsInput: true,
      maxInputs: Number.POSITIVE_INFINITY,
      outputs: [
        ...branches.map((branch, index) => ({
          id: branch.id,
          label: {
            'pt-BR': branch.label || `Caminho ${index + 1}`,
            en: branch.label || `Path ${index + 1}`,
          },
          maxConnections: 1,
          dynamic: true,
        })),
        // Evaluated in order; this is where a contact goes when no path matched.
        { id: 'otherwise', label: OTHERWISE, maxConnections: 1, fallback: true },
      ],
    };
  }

  if (node.type === 'randomizer') {
    const paths = (node.config?.paths ?? []) as Array<{ id: string; label?: string; weight?: number }>;
    return {
      acceptsInput: true,
      maxInputs: Number.POSITIVE_INFINITY,
      outputs: paths.map((path, index) => ({
        id: path.id,
        label: {
          'pt-BR': `${path.label || String.fromCharCode(65 + index)} — ${path.weight ?? 0}%`,
          en: `${path.label || String.fromCharCode(65 + index)} — ${path.weight ?? 0}%`,
        },
        maxConnections: 1,
        dynamic: true,
      })),
    };
  }

  return SEQUENTIAL;
}

export function outputPort(
  node: Pick<FlowNode, 'type' | 'config'>,
  handle: string | null,
): PortDefinition | undefined {
  return portsOf(node).outputs.find((port) => port.id === handle);
}

export type ConnectionRejection =
  | 'UNKNOWN_NODE'
  | 'SELF_CONNECTION'
  | 'TARGET_REFUSES_INPUT'
  | 'UNKNOWN_PORT'
  | 'PORT_FULL'
  | 'TARGET_FULL'
  | 'DUPLICATE';

export interface ConnectionCheck {
  ok: boolean;
  reason?: ConnectionRejection;
}

/**
 * Decides whether one connection may exist. Used by the canvas while the operator
 * is still dragging, and again on the server before a graph is stored — the
 * interface is a convenience, never the authority.
 */
export function canConnect(
  graph: Pick<FlowGraph, 'nodes' | 'edges'>,
  candidate: { source: string; sourceHandle: string | null; target: string },
  options: { ignoreEdgeId?: string } = {},
): ConnectionCheck {
  const source = graph.nodes.find((node) => node.id === candidate.source);
  const target = graph.nodes.find((node) => node.id === candidate.target);
  if (!source || !target) return { ok: false, reason: 'UNKNOWN_NODE' };

  // A node feeding itself is either a mistake or an infinite loop; either way the
  // operator meant something else.
  if (source.id === target.id) return { ok: false, reason: 'SELF_CONNECTION' };

  const port = outputPort(source, candidate.sourceHandle);
  if (!port) return { ok: false, reason: 'UNKNOWN_PORT' };

  const targetPorts = portsOf(target);
  if (!targetPorts.acceptsInput) return { ok: false, reason: 'TARGET_REFUSES_INPUT' };

  const existing = graph.edges.filter((edge) => edge.id !== options.ignoreEdgeId);

  if (
    existing.some(
      (edge) =>
        edge.source === candidate.source &&
        (edge.sourceHandle ?? null) === candidate.sourceHandle &&
        edge.target === candidate.target,
    )
  ) {
    return { ok: false, reason: 'DUPLICATE' };
  }

  const fromPort = existing.filter(
    (edge) =>
      edge.source === candidate.source && (edge.sourceHandle ?? null) === candidate.sourceHandle,
  );
  if (fromPort.length >= port.maxConnections) return { ok: false, reason: 'PORT_FULL' };

  const intoTarget = existing.filter((edge) => edge.target === candidate.target);
  if (intoTarget.length >= targetPorts.maxInputs) return { ok: false, reason: 'TARGET_FULL' };

  return { ok: true };
}

export const CONNECTION_REJECTION_MESSAGES: Record<ConnectionRejection, LocalizedMessage> = {
  UNKNOWN_NODE: {
    'pt-BR': 'Um dos blocos desta conexão não existe mais.',
    en: 'One of the blocks in this connection no longer exists.',
  },
  SELF_CONNECTION: {
    'pt-BR': 'Um bloco não pode se ligar a ele mesmo.',
    en: 'A block cannot connect to itself.',
  },
  TARGET_REFUSES_INPUT: {
    'pt-BR': 'Este bloco não recebe conexões. O gatilho é sempre o começo do fluxo.',
    en: 'This block accepts no incoming connections. The trigger always starts the flow.',
  },
  UNKNOWN_PORT: {
    'pt-BR': 'Esta saída não existe mais neste bloco.',
    en: 'This exit no longer exists on this block.',
  },
  PORT_FULL: {
    'pt-BR': 'Esta saída já leva a um bloco. Uma saída segue um caminho só.',
    en: 'This exit already leads somewhere. One exit follows a single path.',
  },
  TARGET_FULL: {
    'pt-BR': 'Este bloco já recebeu o número máximo de conexões.',
    en: 'This block already has the maximum number of incoming connections.',
  },
  DUPLICATE: {
    'pt-BR': 'Esta conexão já existe.',
    en: 'This connection already exists.',
  },
};

/**
 * Drops edges whose port or node no longer exists.
 *
 * These are not mistakes anybody made: deleting one path of a branch leaves the
 * edge that used to leave it pointing at nothing. Removing them is deterministic
 * clean-up, so it happens quietly. Connections that *are* somebody's mistake —
 * a node wired to itself, two edges on one exit — are refused instead, loudly,
 * because silently deleting those would throw away work the operator meant.
 */
export function pruneOrphanEdges<G extends Pick<FlowGraph, 'nodes' | 'edges'>>(graph: G): G {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  return {
    ...graph,
    edges: graph.edges.filter((edge) => {
      const source = byId.get(edge.source);
      if (!source || !byId.has(edge.target)) return false;
      return Boolean(outputPort(source, edge.sourceHandle ?? null));
    }),
  };
}

/** Edges that no longer describe a possible path, e.g. after a port was removed. */
export function findInvalidEdges(graph: Pick<FlowGraph, 'nodes' | 'edges'>): Array<{
  edge: FlowEdge;
  reason: ConnectionRejection;
}> {
  const invalid: Array<{ edge: FlowEdge; reason: ConnectionRejection }> = [];

  for (const edge of graph.edges) {
    const check = canConnect(
      graph,
      { source: edge.source, sourceHandle: edge.sourceHandle ?? null, target: edge.target },
      { ignoreEdgeId: edge.id },
    );
    if (!check.ok) invalid.push({ edge, reason: check.reason! });
  }

  return invalid;
}
