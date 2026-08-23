import { describe, expect, it } from 'vitest';
import { BUILTIN_TOKENS, validateFlow, type ValidationContext } from '../flow-validation';
import { CAP } from '../capabilities';
import type { FlowGraph } from '../flow';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    availableCapabilities: new Set([CAP.IG_SEND_TEXT]),
    enabledFeatures: new Set(['http_request_node']),
    tagIds: new Set(['tag-1']),
    customFieldIds: new Set(['cf-1']),
    knownTokens: new Set(BUILTIN_TOKENS),
    hasTrigger: true,
    ...overrides,
  };
}

const message = (id: string, text = 'oi') => ({
  id,
  type: 'send_message' as const,
  position: { x: 0, y: 0 },
  config: { blocks: [{ type: 'text', text }], quickReplies: [], asPrivateReply: false },
});

function graph(nodes: FlowGraph['nodes'], edges: FlowGraph['edges']): FlowGraph {
  return { schemaVersion: 1, nodes, edges };
}

const trigger = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, config: {} };
const end = { id: 'e', type: 'end' as const, position: { x: 0, y: 0 }, config: {} };

describe('flow validation', () => {
  it('accepts a straightforward valid flow', () => {
    const report = validateFlow(
      graph(
        [trigger, message('m'), end],
        [
          { id: 'e1', source: 't', target: 'm', sourceHandle: null },
          { id: 'e2', source: 'm', target: 'e', sourceHandle: null },
        ],
      ),
      ctx(),
    );
    expect(report.valid).toBe(true);
  });

  it('rejects a loop with no delay in it', () => {
    const report = validateFlow(
      graph(
        [trigger, message('m')],
        [
          { id: 'e1', source: 't', target: 'm', sourceHandle: null },
          { id: 'e2', source: 'm', target: 't', sourceHandle: null },
        ],
      ),
      ctx(),
    );
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('CYCLE_WITHOUT_DELAY');
  });

  it('allows a loop that contains a delay', () => {
    // A nurture sequence that waits is legitimate; only a delayless loop is a bug.
    const delay = {
      id: 'd',
      type: 'delay' as const,
      position: { x: 0, y: 0 },
      config: { mode: 'duration', amount: 1, unit: 'days', resumeWindow: { enabled: false, startHour: 8, endHour: 20 } },
    };
    const report = validateFlow(
      graph(
        [trigger, message('m'), delay],
        [
          { id: 'e1', source: 't', target: 'm', sourceHandle: null },
          { id: 'e2', source: 'm', target: 'd', sourceHandle: null },
          { id: 'e3', source: 'd', target: 'm', sourceHandle: null },
        ],
      ),
      ctx(),
    );
    expect(report.issues.map((i) => i.code)).not.toContain('CYCLE_WITHOUT_DELAY');
  });

  it('blocks publishing when a node needs an unavailable capability', () => {
    const report = validateFlow(
      graph(
        [trigger, message('m'), end],
        [
          { id: 'e1', source: 't', target: 'm', sourceHandle: null },
          { id: 'e2', source: 'm', target: 'e', sourceHandle: null },
        ],
      ),
      ctx({ availableCapabilities: new Set() }),
    );
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('CAPABILITY_UNAVAILABLE');
  });

  it('blocks a node that is not included in the plan', () => {
    const http = {
      id: 'h',
      type: 'http_request' as const,
      position: { x: 0, y: 0 },
      config: { method: 'GET', url: 'https://example.com', headers: {}, timeoutMs: 5000 },
    };
    const report = validateFlow(
      graph(
        [trigger, http, end],
        [
          { id: 'e1', source: 't', target: 'h', sourceHandle: null },
          { id: 'e2', source: 'h', target: 'e', sourceHandle: null },
        ],
      ),
      ctx({ enabledFeatures: new Set() }),
    );
    expect(report.issues.map((i) => i.code)).toContain('FEATURE_NOT_IN_PLAN');
  });

  it('requires both branches of a condition to be connected', () => {
    const condition = {
      id: 'c',
      type: 'condition' as const,
      position: { x: 0, y: 0 },
      config: { predicate: { kind: 'condition', source: 'tag', field: 'tag-1', operator: 'is_set' } },
    };
    const report = validateFlow(
      graph(
        [trigger, condition, end],
        [
          { id: 'e1', source: 't', target: 'c', sourceHandle: null },
          { id: 'e2', source: 'c', target: 'e', sourceHandle: 'true' },
        ],
      ),
      ctx(),
    );
    const unconnected = report.issues.find((i) => i.code === 'PORT_NOT_CONNECTED');
    expect(unconnected).toBeDefined();
    // The message has to name the exit. "A condition is incomplete" sends the
    // operator hunting; "the No exit is not connected" does not.
    expect(unconnected!.message['pt-BR']).toContain('Não');
    expect(unconnected!.nodeId).toBe('c');
    expect(report.valid).toBe(false);
  });

  it('flags every unconnected exit of a branch, naming each path', () => {
    // Branch nodes were unpublishable: the validator demanded each path be
    // connected while the canvas drew no exits to connect them with.
    const branch = {
      id: 'b',
      type: 'branch' as const,
      position: { x: 0, y: 0 },
      config: {
        branches: [
          {
            id: 'p1',
            label: 'Cliente',
            predicate: { kind: 'condition', source: 'tag', field: 'tag-1', operator: 'is_set' },
          },
          {
            id: 'p2',
            label: 'Lead',
            predicate: { kind: 'condition', source: 'tag', field: 'tag-1', operator: 'is_set' },
          },
        ],
      },
    };
    const report = validateFlow(
      graph(
        [trigger, branch, end],
        [
          { id: 'e1', source: 't', target: 'b', sourceHandle: null },
          { id: 'e2', source: 'b', target: 'e', sourceHandle: 'p1' },
        ],
      ),
      ctx(),
    );

    const messages = report.issues
      .filter((i) => i.code === 'PORT_NOT_CONNECTED')
      .map((i) => i.message['pt-BR']);
    expect(messages.some((m) => m.includes('Lead'))).toBe(true);

    // The fallback exit left open is a deliberate stop, not an error.
    const fallback = report.issues.find((i) => i.code === 'FALLBACK_PORT_NOT_CONNECTED');
    expect(fallback?.severity).toBe('warning');
  });

  it('refuses a graph whose connection the engine could never follow', () => {
    const report = validateFlow(
      graph(
        [trigger, message('m1'), message('m2'), end],
        [
          { id: 'e1', source: 't', target: 'm1', sourceHandle: null },
          // Two edges leaving one exit: the engine follows the first and the
          // second silently never runs.
          { id: 'e2', source: 'm1', target: 'm2', sourceHandle: null },
          { id: 'e3', source: 'm1', target: 'e', sourceHandle: null },
        ],
      ),
      ctx(),
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('INVALID_EDGE_PORT_FULL');
  });

  it('names the setting that is missing instead of saying the block is invalid', () => {
    // "This block is incomplete" sends the operator hunting through a panel.
    // "Choose a tag" is something they can act on straight away.
    const addTag = {
      id: 'a',
      type: 'add_tag' as const,
      position: { x: 0, y: 0 },
      config: {},
    };
    const report = validateFlow(
      graph([trigger, addTag], [{ id: 'e1', source: 't', target: 'a', sourceHandle: null }]),
      ctx(),
    );

    const issue = report.issues.find((i) => i.code === 'NODE_CONFIG_INVALID');
    expect(issue?.message['pt-BR']).toContain('tag');
    expect(issue?.message.en).toContain('tag');
    // The schema path itself must never reach the interface.
    expect(issue?.message['pt-BR']).not.toContain('tagId');
  });

  it('says the randomiser weights do not add up, in words', () => {
    const randomizer = {
      id: 'r',
      type: 'randomizer' as const,
      position: { x: 0, y: 0 },
      config: {
        paths: [
          { id: 'a', label: 'A', weight: 30 },
          { id: 'b', label: 'B', weight: 30 },
        ],
      },
    };
    const report = validateFlow(
      graph([trigger, randomizer], [{ id: 'e1', source: 't', target: 'r', sourceHandle: null }]),
      ctx(),
    );

    const issue = report.issues.find((i) => i.code === 'NODE_CONFIG_INVALID');
    expect(issue?.message['pt-BR']).toContain('100%');
  });

  it('refuses to route on a tapped button when the channel cannot report which one', () => {
    // Receiving the message does not imply knowing which button caused it. Until
    // that is confirmed, offering button routing would produce a path that
    // silently never runs.
    const wait = {
      id: 'w',
      type: 'wait_for_reply' as const,
      position: { x: 0, y: 0 },
      config: {
        options: [
          { id: 'a', label: 'Quero', match: { kind: 'quick_reply', payload: 'btn_a' } },
        ],
        timeoutAmount: 1,
        timeoutUnit: 'days',
      },
    };
    const report = validateFlow(
      graph(
        [trigger, wait, end],
        [
          { id: 'e1', source: 't', target: 'w', sourceHandle: null },
          { id: 'e2', source: 'w', target: 'e', sourceHandle: 'a' },
          { id: 'e3', source: 'w', target: 'e', sourceHandle: 'any' },
          { id: 'e4', source: 'w', target: 'e', sourceHandle: 'timeout' },
        ],
      ),
      ctx({ availableCapabilities: new Set([CAP.IG_SEND_TEXT, CAP.IG_RECEIVE_DM]) }),
    );

    expect(report.issues.map((i) => i.code)).toContain('QUICK_REPLY_ROUTING_UNAVAILABLE');
    expect(report.valid).toBe(false);
  });

  it('allows keyword routing on the same block, which needs no such capability', () => {
    const wait = {
      id: 'w',
      type: 'wait_for_reply' as const,
      position: { x: 0, y: 0 },
      config: {
        options: [
          { id: 'a', label: 'Quero', match: { kind: 'keywords', keywords: ['quero'] } },
        ],
        timeoutAmount: 1,
        timeoutUnit: 'days',
      },
    };
    const report = validateFlow(
      graph(
        [trigger, wait, end],
        [
          { id: 'e1', source: 't', target: 'w', sourceHandle: null },
          { id: 'e2', source: 'w', target: 'e', sourceHandle: 'a' },
          { id: 'e3', source: 'w', target: 'e', sourceHandle: 'any' },
          { id: 'e4', source: 'w', target: 'e', sourceHandle: 'timeout' },
        ],
      ),
      ctx({ availableCapabilities: new Set([CAP.IG_SEND_TEXT, CAP.IG_RECEIVE_DM]) }),
    );

    expect(report.issues.map((i) => i.code)).not.toContain('QUICK_REPLY_ROUTING_UNAVAILABLE');
  });

  it('refuses an automation that starts itself', () => {
    const handoff = {
      id: 'h',
      type: 'start_automation' as const,
      position: { x: 0, y: 0 },
      config: { automationId: 'auto-1', stopCurrent: true },
    };
    const report = validateFlow(
      graph([trigger, handoff], [{ id: 'e1', source: 't', target: 'h', sourceHandle: null }]),
      ctx({ automationId: 'auto-1', startableAutomationIds: new Set(['auto-1']) }),
    );

    expect(report.issues.map((i) => i.code)).toContain('START_AUTOMATION_SELF');
  });

  it('catches a reference to a tag that no longer exists', () => {
    const addTag = {
      id: 'a',
      type: 'add_tag' as const,
      position: { x: 0, y: 0 },
      config: { tagId: 'deleted-tag' },
    };
    const report = validateFlow(
      graph(
        [trigger, addTag, end],
        [
          { id: 'e1', source: 't', target: 'a', sourceHandle: null },
          { id: 'e2', source: 'a', target: 'e', sourceHandle: null },
        ],
      ),
      ctx(),
    );
    expect(report.issues.map((i) => i.code)).toContain('TAG_NOT_FOUND');
  });

  it('warns rather than blocks on an unknown message token', () => {
    const report = validateFlow(
      graph(
        [trigger, message('m', 'oi {{contact.inventado}}'), end],
        [
          { id: 'e1', source: 't', target: 'm', sourceHandle: null },
          { id: 'e2', source: 'm', target: 'e', sourceHandle: null },
        ],
      ),
      ctx(),
    );
    const token = report.issues.find((i) => i.code === 'UNKNOWN_TOKEN');
    expect(token?.severity).toBe('warning');
    expect(report.valid).toBe(true);
  });

  it('blocks publishing with no configured trigger', () => {
    const report = validateFlow(
      graph([trigger, end], [{ id: 'e1', source: 't', target: 'e', sourceHandle: null }]),
      ctx({ hasTrigger: false }),
    );
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('NO_TRIGGER_CONFIGURED');
  });

  it('flags unreachable nodes as a warning with the node attached', () => {
    const report = validateFlow(
      graph([trigger, message('orphan'), end], [{ id: 'e1', source: 't', target: 'e', sourceHandle: null }]),
      ctx(),
    );
    const issue = report.issues.find((i) => i.code === 'UNREACHABLE_NODE');
    expect(issue?.nodeId).toBe('orphan');
  });
});
