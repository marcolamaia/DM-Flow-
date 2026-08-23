import type { Edge, Node } from '@xyflow/react';

/**
 * Tidies a flow without touching what it does.
 *
 * This function only ever returns new positions. It never reads a node's config,
 * never adds or removes an edge, and never reorders a branch's paths — an
 * "organise" button that quietly changed which path ran first would be far worse
 * than a messy canvas.
 *
 * Layout is left-to-right by depth from the trigger, which matches how a flow is
 * read aloud: this happens, then this, and if that, then this other thing.
 */

/** Wide enough for a 236px node plus room for the connection to bend. */
const COLUMN_WIDTH = 340;
const ROW_HEIGHT = 132;
const ORIGIN = { x: 80, y: 60 };

interface Placement {
  depth: number;
  order: number;
}

export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!outgoing.has(edge.source) || !indegree.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  // Roots are the trigger and anything nothing points at — an orphan still has to
  // land somewhere visible rather than being stacked under the first column.
  const roots = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const start = roots.length > 0 ? roots : [nodes[0]!.id];

  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = start.map((id) => ({ id, depth: 0 }));

  // Breadth-first, keeping the deepest position a node was reached at: a block
  // that two branches both lead to belongs after both of them, not beside the
  // first one that happened to find it.
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const known = depths.get(id);
    if (known !== undefined && known >= depth) continue;

    depths.set(id, depth);
    for (const next of outgoing.get(id) ?? []) {
      // Guarded against loops, which are legal when they contain a delay.
      if (depth < nodes.length) queue.push({ id: next, depth: depth + 1 });
    }
  }

  // Anything a cycle hid from the walk still needs a column.
  for (const node of nodes) {
    if (!depths.has(node.id)) depths.set(node.id, 0);
  }

  const columns = new Map<number, string[]>();
  // Ordered by the graph, not by current position, so running this twice on the
  // same flow gives the same result.
  for (const node of nodes) {
    const depth = depths.get(node.id)!;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth)!.push(node.id);
  }

  const placement = new Map<string, Placement>();
  for (const [depth, ids] of columns) {
    ids.forEach((id, order) => placement.set(id, { depth, order }));
  }

  const tallest = Math.max(...[...columns.values()].map((ids) => ids.length));

  return nodes.map((node) => {
    const { depth, order } = placement.get(node.id)!;
    const columnSize = columns.get(depth)!.length;
    // Each column is centred against the tallest one, so branches fan out around
    // the trunk instead of hanging below it.
    const offset = ((tallest - columnSize) * ROW_HEIGHT) / 2;

    return {
      ...node,
      position: {
        x: ORIGIN.x + depth * COLUMN_WIDTH,
        y: ORIGIN.y + offset + order * ROW_HEIGHT,
      },
    };
  });
}
