import type { FlowGraph, FlowNode } from '@dmflow/shared';

export interface ExecutionContextData {
  executionId: string;
  workspaceId: string;
  automationId: string;
  automationVersionId: string;
  contactId: string;
  conversationId: string | null;
  connectedAccountId: string | null;
  variables: Record<string, unknown>;
  graph: FlowGraph;
  workspaceTimezone: string;
  /** What started this run: needed for origin-event-only actions. */
  origin: {
    triggerType?: string;
    eventType?: string;
    commentId?: string;
    mediaId?: string;
    text?: string;
  };
}

export type NodeOutcome =
  | { kind: 'continue'; handle?: string | null; output?: Record<string, unknown> }
  | { kind: 'wait'; resumeAt: Date; output?: Record<string, unknown> }
  /**
   * Park the run until the contact answers, or until the deadline passes.
   *
   * Distinct from 'wait': a delay resumes on time alone, whereas this resumes on
   * whichever comes first — a message arriving, or the timeout — and takes a
   * different exit depending on which one it was.
   */
  | { kind: 'await_reply'; timeoutAt: Date; output?: Record<string, unknown> }
  | { kind: 'end'; output?: Record<string, unknown> }
  /**
   * Hand the contact to another automation.
   *
   * Returned as an outcome rather than started by the executor itself: starting a
   * run is the engine's job, and having the executor call back into the engine
   * would make the two depend on each other in a circle.
   */
  | {
      kind: 'handoff';
      automationId: string;
      stopCurrent: boolean;
      output?: Record<string, unknown>;
    }
  | {
      kind: 'fail';
      errorCode: string;
      errorDetail?: Record<string, unknown>;
      /** Retryable failures keep the execution alive for another attempt. */
      retryable: boolean;
    };

export interface NodeExecutor {
  execute(node: FlowNode, ctx: ExecutionContextData): Promise<NodeOutcome>;
}
