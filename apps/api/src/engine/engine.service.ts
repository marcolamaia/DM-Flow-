import { Injectable } from '@nestjs/common';
import {
  DmFlowError,
  flowGraphSchema,
  uuidv7,
  type FlowGraph,
  type FlowNode,
} from '@dmflow/shared';
import { Prisma } from '@dmflow/db';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { QuotaService } from '../billing/quota.service';
import { NodeExecutorsService } from './node-executors.service';
import { QueueService } from './queue.service';
import { logger } from '../common/logger';
import type { ExecutionContextData, NodeOutcome } from './engine.types';

/** Guards against a flow that loops without ever reaching a delay or an end. */
const MAX_STEPS_PER_EXECUTION = 200;
/** How many nodes a single job advances before yielding the worker. */
const MAX_STEPS_PER_TICK = 40;
const EXECUTION_LOCK_MS = 30_000;
const MAX_NODE_ATTEMPTS = 5;
/**
 * How many times one contact may be handed from automation to automation in a
 * single chain. Two flows that start each other would otherwise spawn runs
 * forever — each one individually well-behaved and bounded.
 */
const MAX_HANDOFF_DEPTH = 5;

export interface StartExecutionInput {
  workspaceId: string;
  automationId: string;
  contactId: string;
  conversationId?: string | null;
  connectedAccountId?: string | null;
  triggerId?: string | null;
  triggerEventId?: string | null;
  variables?: Record<string, unknown>;
  origin?: ExecutionContextData['origin'];
}

@Injectable()
export class EngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly quota: QuotaService,
    private readonly nodes: NodeExecutorsService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Creates an execution pinned to the automation's currently published version.
   * Editing or republishing afterwards cannot change what this run does — that is
   * the whole reason published versions are immutable.
   */
  async start(input: StartExecutionInput): Promise<{ executionId: string } | { skipped: string }> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: input.automationId },
      include: { publishedVersion: true },
    });

    if (!automation || automation.workspaceId !== input.workspaceId) {
      return { skipped: 'automation_not_found' };
    }
    if (automation.status !== 'PUBLISHED' || !automation.publishedVersion) {
      return { skipped: 'automation_not_published' };
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: input.workspaceId },
    });
    if (workspace?.status === 'SUSPENDED') {
      return { skipped: 'workspace_suspended' };
    }

    const contact = await this.prisma.contact.findUnique({ where: { id: input.contactId } });
    if (!contact || contact.status !== 'ACTIVE') {
      return { skipped: 'contact_not_active' };
    }

    // Re-entry policy: a contact already inside this automation is not enrolled
    // twice. Two runs of the same flow would double every message it sends.
    const inFlight = await this.prisma.execution.findFirst({
      where: {
        workspaceId: input.workspaceId,
        automationId: input.automationId,
        contactId: input.contactId,
        status: { in: ['RUNNING', 'WAITING'] },
      },
      select: { id: true },
    });
    if (inFlight) return { skipped: 'already_running_for_contact' };

    const withinQuota = await this.quota.tryConsume(input.workspaceId, 'executions_started');
    if (!withinQuota) return { skipped: 'execution_quota_exceeded' };

    const graph = flowGraphSchema.parse(automation.publishedVersion.graph);
    const entry = graph.nodes.find((n) => n.type === 'trigger');
    if (!entry) return { skipped: 'no_trigger_node' };

    const executionId = uuidv7();
    await this.prisma.execution.create({
      data: {
        id: executionId,
        workspaceId: input.workspaceId,
        automationId: input.automationId,
        automationVersionId: automation.publishedVersion.id,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        triggerId: input.triggerId ?? null,
        triggerEventId: input.triggerEventId ?? null,
        status: 'RUNNING',
        currentNodeId: entry.id,
        variables: {
          ...(input.variables ?? {}),
          __origin: input.origin ?? {},
          __connectedAccountId: input.connectedAccountId ?? null,
        } as never,
      },
    });

    await this.queue.enqueueExecution(executionId, 'start');
    return { executionId };
  }

  /**
   * Advances one execution.
   *
   * Concurrency is handled twice on purpose: a Redis lock stops two workers picking
   * up the same execution, and an optimistic version check on every write is what
   * actually guarantees it — locks can expire mid-step, version numbers cannot lie.
   */
  async advance(executionId: string): Promise<void> {
    const acquired = await this.redis.withLock(`exec:${executionId}`, EXECUTION_LOCK_MS, () =>
      this.runSteps(executionId),
    );

    if (acquired === undefined) {
      logger.debug({ executionId }, 'execution already being advanced elsewhere');
    }
  }

  private async runSteps(executionId: string): Promise<void> {
    for (let tick = 0; tick < MAX_STEPS_PER_TICK; tick += 1) {
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { automationVersion: true, automation: true },
      });

      if (!execution) return;
      if (execution.status !== 'RUNNING') return;

      if (execution.stepCount >= MAX_STEPS_PER_EXECUTION) {
        await this.failExecution(execution.id, execution.lockVersion, {
          code: 'EXECUTION_STEP_BUDGET_EXCEEDED',
          detail: { stepCount: execution.stepCount },
        });
        return;
      }

      const graph = flowGraphSchema.parse(execution.automationVersion.graph) as FlowGraph;
      const node = graph.nodes.find((n) => n.id === execution.currentNodeId);

      if (!node) {
        await this.completeExecution(execution.id, execution.lockVersion, 'node_missing');
        return;
      }

      const variables = (execution.variables ?? {}) as Record<string, unknown>;
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: execution.workspaceId },
      });

      const ctx: ExecutionContextData = {
        executionId: execution.id,
        workspaceId: execution.workspaceId,
        automationId: execution.automationId,
        automationVersionId: execution.automationVersionId,
        contactId: execution.contactId,
        conversationId: execution.conversationId,
        connectedAccountId: (variables.__connectedAccountId as string | null) ?? null,
        variables,
        graph,
        workspaceTimezone: workspace?.timezone ?? 'UTC',
        origin: (variables.__origin ?? {}) as ExecutionContextData['origin'],
      };

      const stepId = uuidv7();
      const startedAt = new Date();
      await this.prisma.executionStep.create({
        data: {
          id: stepId,
          workspaceId: execution.workspaceId,
          executionId: execution.id,
          nodeId: node.id,
          nodeType: node.type,
          sequence: execution.stepCount + 1,
          status: 'RUNNING',
          input: { config: node.config } as never,
          startedAt,
        },
      });

      let outcome: NodeOutcome;
      try {
        outcome = await this.nodes.execute(node, ctx);
      } catch (error) {
        outcome = {
          kind: 'fail',
          errorCode: error instanceof DmFlowError ? error.code : 'INTERNAL_ERROR',
          errorDetail: { message: (error as Error).message },
          retryable: error instanceof DmFlowError ? error.retryable : true,
        };
      }

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      const shouldContinue = await this.applyOutcome(
        execution.id,
        execution.lockVersion,
        stepId,
        node,
        graph,
        outcome,
        { finishedAt, durationMs, attempt: execution.attemptCount },
        ctx,
      );

      if (!shouldContinue) return;
    }

    // Yield rather than hold a worker: the next job picks the execution straight up.
    await this.queue.enqueueExecution(executionId, 'resume');
  }

  private async applyOutcome(
    executionId: string,
    lockVersion: number,
    stepId: string,
    node: FlowNode,
    graph: FlowGraph,
    outcome: NodeOutcome,
    meta: { finishedAt: Date; durationMs: number; attempt: number },
    ctx: ExecutionContextData,
  ): Promise<boolean> {
    switch (outcome.kind) {
      case 'continue': {
        const next = this.nextNodeId(graph, node.id, outcome.handle ?? null);
        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'COMPLETED',
            output: (outcome.output ?? {}) as never,
            finishedAt: meta.finishedAt,
            durationMs: meta.durationMs,
          },
        });

        if (!next) {
          await this.completeExecution(executionId, lockVersion, 'no_outgoing_edge');
          return false;
        }

        const updated = await this.prisma.execution.updateMany({
          where: { id: executionId, lockVersion },
          data: {
            currentNodeId: next,
            stepCount: { increment: 1 },
            attemptCount: 0,
            lockVersion: { increment: 1 },
          },
        });
        return updated.count === 1;
      }

      case 'wait': {
        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'COMPLETED',
            output: (outcome.output ?? {}) as never,
            finishedAt: meta.finishedAt,
            durationMs: meta.durationMs,
          },
        });

        const next = this.nextNodeId(graph, node.id, null);
        if (!next) {
          await this.completeExecution(executionId, lockVersion, 'delay_without_next');
          return false;
        }

        // resumeAt lives in Postgres, not only in a delayed queue message: Redis can
        // be flushed, and a three-day wait must survive that.
        await this.prisma.execution.updateMany({
          where: { id: executionId, lockVersion },
          data: {
            status: 'WAITING',
            currentNodeId: next,
            resumeAt: outcome.resumeAt,
            stepCount: { increment: 1 },
            attemptCount: 0,
            lockVersion: { increment: 1 },
          },
        });
        return false;
      }

      case 'await_reply': {
        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'RUNNING',
            output: (outcome.output ?? {}) as never,
          },
        });

        // The run stays parked ON this node, not on the next one: which exit it
        // eventually takes depends on what the contact says, and that is not
        // known yet. resumeAt carries the deadline so the sweeper can take the
        // timeout path if nobody ever answers.
        await this.prisma.execution.updateMany({
          where: { id: executionId, lockVersion },
          data: {
            status: 'WAITING',
            currentNodeId: node.id,
            awaitingReplyNodeId: node.id,
            resumeAt: outcome.timeoutAt,
            stepCount: { increment: 1 },
            attemptCount: 0,
            lockVersion: { increment: 1 },
          },
        });
        return false;
      }

      case 'handoff': {
        // The other automation starts as its own run, pinned to its own published
        // version. Nesting one flow's steps inside another would make a change to
        // the callee silently rewrite what the caller does mid-execution.
        const depth = Number(ctx.variables.__handoffDepth ?? 0);
        const started =
          depth >= MAX_HANDOFF_DEPTH
            ? { skipped: 'handoff_depth_exceeded' as const }
            : await this.start({
                workspaceId: ctx.workspaceId,
                automationId: outcome.automationId,
                contactId: ctx.contactId,
                conversationId: ctx.conversationId,
                connectedAccountId: ctx.connectedAccountId,
                variables: { __handoffDepth: depth + 1, __origin: ctx.origin },
                origin: ctx.origin,
              });

        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'COMPLETED',
            output: {
              ...(outcome.output ?? {}),
              startedAutomationId: outcome.automationId,
              ...('executionId' in started
                ? { startedExecutionId: started.executionId }
                : { notStarted: started.skipped }),
            } as never,
            finishedAt: meta.finishedAt,
            durationMs: meta.durationMs,
          },
        });

        if (outcome.stopCurrent) {
          await this.completeExecution(executionId, lockVersion, 'handed_off');
          return false;
        }

        const next = this.nextNodeId(graph, node.id, null);
        if (!next) {
          await this.completeExecution(executionId, lockVersion, 'no_outgoing_edge');
          return false;
        }

        const updated = await this.prisma.execution.updateMany({
          where: { id: executionId, lockVersion },
          data: {
            currentNodeId: next,
            stepCount: { increment: 1 },
            attemptCount: 0,
            lockVersion: { increment: 1 },
          },
        });
        return updated.count === 1;
      }

      case 'end': {
        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'COMPLETED',
            output: (outcome.output ?? {}) as never,
            finishedAt: meta.finishedAt,
            durationMs: meta.durationMs,
          },
        });
        await this.completeExecution(executionId, lockVersion, 'reached_end');
        return false;
      }

      case 'fail': {
        await this.prisma.executionStep.update({
          where: { id: stepId },
          data: {
            status: 'FAILED',
            errorCode: outcome.errorCode,
            errorDetail: (outcome.errorDetail ?? {}) as never,
            finishedAt: meta.finishedAt,
            durationMs: meta.durationMs,
          },
        });

        const attempt = meta.attempt + 1;
        if (outcome.retryable && attempt < MAX_NODE_ATTEMPTS) {
          const delayMs = Math.min(60_000 * 2 ** (attempt - 1), 15 * 60_000);
          await this.prisma.execution.updateMany({
            where: { id: executionId, lockVersion },
            data: {
              status: 'WAITING',
              resumeAt: new Date(Date.now() + delayMs),
              attemptCount: attempt,
              lastError: { code: outcome.errorCode, detail: outcome.errorDetail } as never,
              lockVersion: { increment: 1 },
            },
          });
          return false;
        }

        await this.failExecution(executionId, lockVersion, {
          code: outcome.errorCode,
          detail: outcome.errorDetail,
        });
        return false;
      }
    }
  }

  /**
   * Follows the edge for a given handle. Condition and branch nodes label their
   * edges; everything else uses the single unlabelled edge.
   */
  private nextNodeId(graph: FlowGraph, fromId: string, handle: string | null): string | null {
    const edges = graph.edges.filter((e) => e.source === fromId);
    if (edges.length === 0) return null;

    if (handle !== null) {
      const match = edges.find((e) => e.sourceHandle === handle);
      return match?.target ?? null;
    }

    const plain = edges.find((e) => !e.sourceHandle) ?? edges[0];
    return plain?.target ?? null;
  }

  private async completeExecution(
    executionId: string,
    lockVersion: number,
    reason: string,
  ): Promise<void> {
    await this.prisma.execution.updateMany({
      where: { id: executionId, lockVersion },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        currentNodeId: null,
        lastError: Prisma.DbNull,
        lockVersion: { increment: 1 },
      },
    });
    logger.debug({ executionId, reason }, 'execution completed');
  }

  private async failExecution(
    executionId: string,
    lockVersion: number,
    error: { code: string; detail?: Record<string, unknown> },
  ): Promise<void> {
    await this.prisma.execution.updateMany({
      where: { id: executionId, lockVersion },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        lastError: error as never,
        lockVersion: { increment: 1 },
      },
    });
    logger.warn({ executionId, errorCode: error.code }, 'execution failed');
  }

  async cancel(workspaceId: string, executionId: string): Promise<void> {
    const execution = await this.prisma.execution.findUnique({ where: { id: executionId } });
    this.prisma.assertTenant(execution, workspaceId);

    await this.prisma.execution.updateMany({
      where: { id: executionId, workspaceId, status: { in: ['RUNNING', 'WAITING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date(), lockVersion: { increment: 1 } },
    });
  }

  /**
   * Wakes executions whose delay has elapsed. Driven by the database rather than by
   * queue timers, so a lost or flushed Redis job never strands a conversation.
   */
  async wakeDueExecutions(limit = 200): Promise<number> {
    const due = await this.prisma.execution.findMany({
      where: { status: 'WAITING', resumeAt: { lte: new Date() } },
      select: {
        id: true,
        lockVersion: true,
        awaitingReplyNodeId: true,
        automationVersion: { select: { graph: true } },
      },
      take: limit,
      orderBy: { resumeAt: 'asc' },
    });

    let woken = 0;
    for (const execution of due) {
      // A run parked on "wait for reply" whose deadline passed leaves by the
      // no-reply exit, not by carrying on where it stood.
      const next = execution.awaitingReplyNodeId
        ? this.nextNodeId(
            flowGraphSchema.parse(execution.automationVersion.graph) as FlowGraph,
            execution.awaitingReplyNodeId,
            'timeout',
          )
        : undefined;

      if (execution.awaitingReplyNodeId && !next) {
        // Nothing connected to the no-reply exit: the contact simply leaves.
        await this.completeExecution(execution.id, execution.lockVersion, 'reply_timeout');
        woken += 1;
        continue;
      }

      const updated = await this.prisma.execution.updateMany({
        where: { id: execution.id, lockVersion: execution.lockVersion, status: 'WAITING' },
        data: {
          status: 'RUNNING',
          resumeAt: null,
          awaitingReplyNodeId: null,
          ...(next ? { currentNodeId: next } : {}),
          lockVersion: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        await this.queue.enqueueExecution(execution.id, 'resume');
        woken += 1;
      }
    }

    return woken;
  }

  /**
   * Resumes runs parked on a "wait for reply" block in this conversation.
   *
   * Called when a message arrives from the contact. Which exit each run takes is
   * decided here, from its own block's options, because two runs parked on
   * different blocks may read the same message differently.
   */
  async deliverReply(input: {
    workspaceId: string;
    conversationId: string;
    text: string;
    quickReplyPayload?: string | null;
  }): Promise<number> {
    const waiting = await this.prisma.execution.findMany({
      where: {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        status: 'WAITING',
        awaitingReplyNodeId: { not: null },
      },
      select: {
        id: true,
        lockVersion: true,
        awaitingReplyNodeId: true,
        variables: true,
        automationVersion: { select: { graph: true } },
      },
      take: 20,
    });

    let resumed = 0;
    for (const execution of waiting) {
      const graph = flowGraphSchema.parse(execution.automationVersion.graph) as FlowGraph;
      const node = graph.nodes.find((entry) => entry.id === execution.awaitingReplyNodeId);
      if (!node) continue;

      const handle = matchReply(node, input.text, input.quickReplyPayload ?? null);
      const next = this.nextNodeId(graph, node.id, handle);

      if (!next) {
        await this.completeExecution(execution.id, execution.lockVersion, 'reply_exit_unconnected');
        resumed += 1;
        continue;
      }

      const updated = await this.prisma.execution.updateMany({
        where: { id: execution.id, lockVersion: execution.lockVersion, status: 'WAITING' },
        data: {
          status: 'RUNNING',
          resumeAt: null,
          awaitingReplyNodeId: null,
          currentNodeId: next,
          // What the contact said is available to every step downstream, which is
          // the whole point of having asked.
          variables: {
            ...((execution.variables ?? {}) as Record<string, unknown>),
            reply: { text: input.text, option: handle },
          } as never,
          attemptCount: 0,
          lockVersion: { increment: 1 },
        },
      });

      if (updated.count === 1) {
        await this.queue.enqueueExecution(execution.id, 'resume');
        resumed += 1;
      }
    }

    if (resumed > 0) {
      logger.info(
        { conversationId: input.conversationId, resumed },
        'resumed executions waiting on a reply',
      );
    }
    return resumed;
  }
}

/**
 * Which exit a reply takes.
 *
 * Options are checked in the order the operator arranged them, so overlapping
 * keywords resolve predictably rather than by whichever matched first in some
 * internal order. A tapped button wins over typed text: it is the stronger
 * signal, and the contact chose it deliberately.
 */
function matchReply(
  node: FlowNode,
  text: string,
  quickReplyPayload: string | null,
): string {
  const options = (node.config?.options ?? []) as Array<{
    id: string;
    match: { kind: string; payload?: string; keywords?: string[] };
  }>;

  if (quickReplyPayload) {
    const tapped = options.find(
      (option) => option.match.kind === 'quick_reply' && option.match.payload === quickReplyPayload,
    );
    if (tapped) return tapped.id;
  }

  const normalized = normalizeForMatch(text);
  for (const option of options) {
    if (option.match.kind !== 'keywords') continue;
    const keywords = option.match.keywords ?? [];
    if (keywords.some((keyword) => normalized.includes(normalizeForMatch(keyword)))) {
      return option.id;
    }
  }

  return 'any';
}

/** Accent- and case-insensitive, so "SIM" and "sim" reach the same path. */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
