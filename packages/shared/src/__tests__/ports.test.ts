import { describe, expect, it } from 'vitest';
import {
  canConnect,
  findInvalidEdges,
  outputPort,
  portsOf,
  pruneOrphanEdges,
} from '../ports';
import type { FlowGraph } from '../flow';

const node = (id: string, type: string, config: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, config }) as FlowGraph['nodes'][number];

const edge = (id: string, source: string, target: string, sourceHandle: string | null = null) =>
  ({ id, source, target, sourceHandle }) as FlowGraph['edges'][number];

const graph = (nodes: FlowGraph['nodes'], edges: FlowGraph['edges']): FlowGraph => ({
  schemaVersion: 1,
  nodes,
  edges,
});

describe('port layout', () => {
  it('gives an ordinary block one way in and one way on', () => {
    const layout = portsOf(node('a', 'send_message'));

    expect(layout.acceptsInput).toBe(true);
    expect(layout.outputs).toHaveLength(1);
    expect(layout.outputs[0]!.id).toBeNull();
  });

  it('refuses anything connecting into the trigger', () => {
    // A run begins at the trigger, so an edge arriving there would describe a
    // path that can never be taken.
    expect(portsOf(node('t', 'trigger')).acceptsInput).toBe(false);
  });

  it('gives a condition two named, independent exits', () => {
    const outputs = portsOf(node('c', 'condition')).outputs;

    expect(outputs.map((port) => port.id)).toEqual(['true', 'false']);
    expect(outputs.every((port) => port.maxConnections === 1)).toBe(true);
  });

  it('draws one exit per branch path plus a fallback', () => {
    // This is the bug that made branch nodes unpublishable: the canvas drew no
    // exits at all, while the validator demanded every path be connected.
    const branch = node('b', 'branch', {
      branches: [
        { id: 'p1', label: 'Cliente' },
        { id: 'p2', label: 'Lead' },
      ],
    });

    expect(portsOf(branch).outputs.map((port) => port.id)).toEqual(['p1', 'p2', 'otherwise']);
    expect(outputPort(branch, 'otherwise')!.fallback).toBe(true);
  });

  it('draws one exit per randomiser path, labelled with its share', () => {
    const randomizer = node('r', 'randomizer', {
      paths: [
        { id: 'a', label: 'A', weight: 30 },
        { id: 'b', label: 'B', weight: 70 },
      ],
    });

    const outputs = portsOf(randomizer).outputs;
    expect(outputs.map((port) => port.id)).toEqual(['a', 'b']);
    expect(outputs[0]!.label['pt-BR']).toContain('30%');
  });

  it('gives terminal blocks no exit at all', () => {
    expect(portsOf(node('e', 'end')).outputs).toHaveLength(0);
    expect(portsOf(node('u', 'unsubscribe_contact')).outputs).toHaveLength(0);
  });

  it('follows a branch path label as it is renamed', () => {
    const before = portsOf(node('b', 'branch', { branches: [{ id: 'p1', label: 'Antigo' }] }));
    const after = portsOf(node('b', 'branch', { branches: [{ id: 'p1', label: 'Novo' }] }));

    expect(before.outputs[0]!.label['pt-BR']).toBe('Antigo');
    expect(after.outputs[0]!.label['pt-BR']).toBe('Novo');
  });
});

describe('connection rules', () => {
  const base = graph([node('a', 'send_message'), node('b', 'send_message'), node('t', 'trigger')], []);

  it('accepts an ordinary connection', () => {
    expect(canConnect(base, { source: 'a', sourceHandle: null, target: 'b' }).ok).toBe(true);
  });

  it('refuses a block wired to itself', () => {
    const check = canConnect(base, { source: 'a', sourceHandle: null, target: 'a' });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('SELF_CONNECTION');
  });

  it('refuses anything pointing into the trigger', () => {
    const check = canConnect(base, { source: 'a', sourceHandle: null, target: 't' });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('TARGET_REFUSES_INPUT');
  });

  it('refuses a second edge on an exit that already leads somewhere', () => {
    // The engine follows exactly one edge per exit. Allowing a second one means
    // the operator draws two paths and only ever one of them runs.
    const withEdge = graph(base.nodes.concat(node('c', 'send_message')), [edge('e1', 'a', 'b')]);
    const check = canConnect(withEdge, { source: 'a', sourceHandle: null, target: 'c' });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('PORT_FULL');
  });

  it('lets two different exits of a condition reach different blocks', () => {
    const withCondition = graph(
      [node('c', 'condition'), node('a', 'send_message'), node('b', 'send_message')],
      [edge('e1', 'c', 'a', 'true')],
    );

    expect(canConnect(withCondition, { source: 'c', sourceHandle: 'false', target: 'b' }).ok).toBe(
      true,
    );
  });

  it('lets several blocks converge on the same block', () => {
    // Two branches leading to one closing message is ordinary, not a mistake.
    const converging = graph(
      [node('a', 'send_message'), node('b', 'send_message'), node('c', 'send_message')],
      [edge('e1', 'a', 'c')],
    );

    expect(canConnect(converging, { source: 'b', sourceHandle: null, target: 'c' }).ok).toBe(true);
  });

  it('refuses a duplicate of a connection that already exists', () => {
    const withEdge = graph(base.nodes, [edge('e1', 'a', 'b')]);
    const check = canConnect(withEdge, { source: 'a', sourceHandle: null, target: 'b' });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('DUPLICATE');
  });

  it('refuses an exit the block does not have', () => {
    const check = canConnect(base, { source: 'a', sourceHandle: 'inventado', target: 'b' });

    expect(check.ok).toBe(false);
    expect(check.reason).toBe('UNKNOWN_PORT');
  });

  it('ignores the edge being reconnected when judging its replacement', () => {
    // Dragging an existing connection to a new target must not be refused by the
    // connection it is itself replacing.
    const withEdge = graph(base.nodes.concat(node('c', 'send_message')), [edge('e1', 'a', 'b')]);
    const check = canConnect(
      withEdge,
      { source: 'a', sourceHandle: null, target: 'c' },
      { ignoreEdgeId: 'e1' },
    );

    expect(check.ok).toBe(true);
  });
});

describe('graph clean-up', () => {
  it('drops edges left behind when a branch path is deleted', () => {
    const before = graph(
      [node('b', 'branch', { branches: [{ id: 'p1' }] }), node('x', 'send_message')],
      [edge('kept', 'b', 'x', 'p1'), edge('orphan', 'b', 'x', 'p2')],
    );

    expect(pruneOrphanEdges(before).edges.map((e) => e.id)).toEqual(['kept']);
  });

  it('drops edges whose block is gone', () => {
    const before = graph([node('a', 'send_message')], [edge('e1', 'a', 'sumiu')]);

    expect(pruneOrphanEdges(before).edges).toHaveLength(0);
  });

  it('keeps everything in a graph that is already sound', () => {
    const sound = graph(
      [node('a', 'send_message'), node('b', 'send_message')],
      [edge('e1', 'a', 'b')],
    );

    expect(pruneOrphanEdges(sound).edges).toHaveLength(1);
    expect(findInvalidEdges(sound)).toHaveLength(0);
  });

  it('reports an edge that became impossible without anybody touching it', () => {
    const broken = graph(
      [node('a', 'send_message'), node('b', 'send_message')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')],
    );

    const invalid = findInvalidEdges(broken);
    expect(invalid).toHaveLength(2);
    expect(invalid.map((entry) => entry.reason)).toContain('DUPLICATE');
  });
});
