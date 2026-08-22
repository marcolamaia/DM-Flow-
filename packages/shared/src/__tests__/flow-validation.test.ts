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
    expect(report.issues.map((i) => i.code)).toContain('CONDITION_MISSING_BRANCH');
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
