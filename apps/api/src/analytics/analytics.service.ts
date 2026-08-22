import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Every number here is derived from rows DM FLOW actually stored. Nothing is
 * estimated, inferred or filled with sample data — a dashboard that shows a
 * plausible-looking number it cannot defend is worse than one that shows nothing.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(workspaceId: string, range: DateRange) {
    const [executions, messagesOut, messagesIn, contacts, conversations] = await Promise.all([
      this.prisma.execution.groupBy({
        by: ['status'],
        where: { workspaceId, startedAt: { gte: range.from, lte: range.to } },
        _count: true,
      }),
      this.prisma.message.groupBy({
        by: ['status'],
        where: {
          workspaceId,
          direction: 'OUTBOUND',
          createdAt: { gte: range.from, lte: range.to },
        },
        _count: true,
      }),
      this.prisma.message.count({
        where: {
          workspaceId,
          direction: 'INBOUND',
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      this.prisma.contact.count({
        where: { workspaceId, deletedAt: null, createdAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.conversation.count({
        where: { workspaceId, createdAt: { gte: range.from, lte: range.to } },
      }),
    ]);

    const byStatus = (rows: Array<{ status: string; _count: number }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count]));

    const execCounts = byStatus(executions as never);
    const started = Object.values(execCounts).reduce((a, b) => a + b, 0);
    const completed = execCounts.COMPLETED ?? 0;

    const msgCounts = byStatus(messagesOut as never);
    const sent = (msgCounts.SENT ?? 0) + (msgCounts.DELIVERED ?? 0);
    const failed = msgCounts.FAILED ?? 0;

    return {
      range: { from: range.from, to: range.to },
      executions: {
        started,
        completed,
        failed: execCounts.FAILED ?? 0,
        cancelled: execCounts.CANCELLED ?? 0,
        running: (execCounts.RUNNING ?? 0) + (execCounts.WAITING ?? 0),
        completionRate: started > 0 ? Number((completed / started).toFixed(4)) : null,
      },
      messages: {
        sent,
        failed,
        queued: msgCounts.QUEUED ?? 0,
        received: messagesIn,
        deliveryRate: sent + failed > 0 ? Number((sent / (sent + failed)).toFixed(4)) : null,
      },
      contacts: { new: contacts },
      conversations: { new: conversations },
    };
  }

  /** Execution volume per day, for the dashboard chart. */
  async executionsOverTime(workspaceId: string, range: DateRange) {
    return this.prisma.$queryRaw<Array<{ day: Date; started: bigint; completed: bigint; failed: bigint }>>`
      SELECT date_trunc('day', "startedAt") AS day,
             COUNT(*)::bigint AS started,
             COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed,
             COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed
      FROM "Execution"
      WHERE "workspaceId" = ${workspaceId}
        AND "startedAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY 1
      ORDER BY 1
    `.then((rows) =>
      rows.map((r) => ({
        day: r.day,
        started: Number(r.started),
        completed: Number(r.completed),
        failed: Number(r.failed),
      })),
    );
  }

  async byAutomation(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        automationId: string;
        name: string;
        started: bigint;
        completed: bigint;
        failed: bigint;
        median_ms: number | null;
      }>
    >`
      SELECT a.id AS "automationId",
             a.name,
             COUNT(e.*)::bigint AS started,
             COUNT(e.*) FILTER (WHERE e.status = 'COMPLETED')::bigint AS completed,
             COUNT(e.*) FILTER (WHERE e.status = 'FAILED')::bigint AS failed,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (e."finishedAt" - e."startedAt")) * 1000
             ) FILTER (WHERE e."finishedAt" IS NOT NULL) AS median_ms
      FROM "Automation" a
      LEFT JOIN "Execution" e
        ON e."automationId" = a.id AND e."startedAt" BETWEEN ${range.from} AND ${range.to}
      WHERE a."workspaceId" = ${workspaceId} AND a."deletedAt" IS NULL
      GROUP BY a.id, a.name
      ORDER BY started DESC
    `;

    return rows.map((r) => ({
      automationId: r.automationId,
      name: r.name,
      started: Number(r.started),
      completed: Number(r.completed),
      failed: Number(r.failed),
      completionRate:
        Number(r.started) > 0 ? Number((Number(r.completed) / Number(r.started)).toFixed(4)) : null,
      medianDurationMs: r.median_ms !== null ? Math.round(r.median_ms) : null,
    }));
  }

  /**
   * Per-node counts, drawn as an overlay on the canvas. Drop-off between adjacent
   * nodes is where an operator actually finds what is wrong with a flow.
   */
  async byNode(workspaceId: string, automationId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        nodeId: string;
        nodeType: string;
        entered: bigint;
        completed: bigint;
        failed: bigint;
        avg_ms: number | null;
      }>
    >`
      SELECT s."nodeId", s."nodeType",
             COUNT(*)::bigint AS entered,
             COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::bigint AS completed,
             COUNT(*) FILTER (WHERE s.status = 'FAILED')::bigint AS failed,
             AVG(s."durationMs") AS avg_ms
      FROM "ExecutionStep" s
      JOIN "Execution" e ON e.id = s."executionId"
      WHERE s."workspaceId" = ${workspaceId}
        AND e."automationId" = ${automationId}
        AND s."startedAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY s."nodeId", s."nodeType"
      ORDER BY entered DESC
    `;

    return rows.map((r) => ({
      nodeId: r.nodeId,
      nodeType: r.nodeType,
      entered: Number(r.entered),
      completed: Number(r.completed),
      failed: Number(r.failed),
      avgDurationMs: r.avg_ms !== null ? Math.round(r.avg_ms) : null,
    }));
  }

  /** Failure reasons grouped by internal error code, so fixes have a target. */
  async failureBreakdown(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.executionStep.groupBy({
      by: ['errorCode', 'nodeType'],
      where: {
        workspaceId,
        status: 'FAILED',
        startedAt: { gte: range.from, lte: range.to },
      },
      _count: true,
      orderBy: { _count: { errorCode: 'desc' } },
      take: 20,
    });

    return rows.map((r) => ({
      errorCode: r.errorCode ?? 'UNKNOWN',
      nodeType: r.nodeType,
      count: r._count,
    }));
  }

  async triggerPerformance(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ type: string; started: bigint; completed: bigint }>
    >`
      SELECT t.type,
             COUNT(e.*)::bigint AS started,
             COUNT(e.*) FILTER (WHERE e.status = 'COMPLETED')::bigint AS completed
      FROM "Trigger" t
      LEFT JOIN "Execution" e
        ON e."triggerId" = t.id AND e."startedAt" BETWEEN ${range.from} AND ${range.to}
      WHERE t."workspaceId" = ${workspaceId}
      GROUP BY t.type
      ORDER BY started DESC
    `;

    return rows.map((r) => ({
      type: r.type,
      started: Number(r.started),
      completed: Number(r.completed),
    }));
  }

  async contactGrowth(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; source: string | null; count: bigint }>
    >`
      SELECT date_trunc('day', "createdAt") AS day, source, COUNT(*)::bigint AS count
      FROM "Contact"
      WHERE "workspaceId" = ${workspaceId}
        AND "deletedAt" IS NULL
        AND "createdAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY 1, 2
      ORDER BY 1
    `;
    return rows.map((r) => ({ day: r.day, source: r.source ?? 'unknown', count: Number(r.count) }));
  }

  /**
   * Response rate: how often a contact replied after we messaged them. Computed
   * from real message pairs rather than an engagement estimate.
   */
  async responsiveness(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ outbound: bigint; replied: bigint; median_reply_seconds: number | null }>
    >`
      WITH outbound AS (
        SELECT m.id, m."conversationId", m."createdAt"
        FROM "Message" m
        WHERE m."workspaceId" = ${workspaceId}
          AND m.direction = 'OUTBOUND'
          AND m.status IN ('SENT', 'DELIVERED')
          AND m."createdAt" BETWEEN ${range.from} AND ${range.to}
      ),
      first_reply AS (
        SELECT o.id,
               (SELECT MIN(r."createdAt") FROM "Message" r
                 WHERE r."conversationId" = o."conversationId"
                   AND r.direction = 'INBOUND'
                   AND r."createdAt" > o."createdAt") AS replied_at,
               o."createdAt" AS sent_at
        FROM outbound o
      )
      SELECT COUNT(*)::bigint AS outbound,
             COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::bigint AS replied,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (replied_at - sent_at))
             ) FILTER (WHERE replied_at IS NOT NULL) AS median_reply_seconds
      FROM first_reply
    `;

    const row = rows[0];
    const outbound = Number(row?.outbound ?? 0);
    const replied = Number(row?.replied ?? 0);

    return {
      outbound,
      replied,
      responseRate: outbound > 0 ? Number((replied / outbound).toFixed(4)) : null,
      medianReplySeconds:
        row?.median_reply_seconds != null ? Math.round(row.median_reply_seconds) : null,
    };
  }

  /** Integration health, so a silent failure has somewhere to become visible. */
  async integrationHealth(workspaceId: string, range: DateRange) {
    const [accounts, events, failedMessages] = await Promise.all([
      this.prisma.connectedAccount.findMany({
        where: { workspaceId, deletedAt: null },
        select: {
          id: true,
          username: true,
          channel: true,
          status: true,
          statusDetail: true,
          tokenExpiresAt: true,
          lastHealthCheckAt: true,
          isSandbox: true,
        },
      }),
      this.prisma.webhookEvent.groupBy({
        by: ['status'],
        where: { workspaceId, receivedAt: { gte: range.from, lte: range.to } },
        _count: true,
      }),
      this.prisma.message.groupBy({
        by: ['failureCode'],
        where: {
          workspaceId,
          status: 'FAILED',
          createdAt: { gte: range.from, lte: range.to },
        },
        _count: true,
      }),
    ]);

    return {
      accounts: accounts.map((a) => ({
        ...a,
        tokenExpiresInDays: a.tokenExpiresAt
          ? Math.max(0, Math.ceil((a.tokenExpiresAt.getTime() - Date.now()) / 86_400_000))
          : null,
      })),
      webhookEvents: Object.fromEntries(
        (events as Array<{ status: string; _count: number }>).map((e) => [e.status, e._count]),
      ),
      messageFailures: (failedMessages as Array<{ failureCode: string | null; _count: number }>).map(
        (f) => ({ code: f.failureCode ?? 'UNKNOWN', count: f._count }),
      ),
    };
  }

  async inboxPerformance(workspaceId: string, range: DateRange) {
    const rows = await this.prisma.$queryRaw<
      Array<{ assignee: string | null; name: string | null; conversations: bigint; messages: bigint }>
    >`
      SELECT c."assigneeId" AS assignee,
             u.name,
             COUNT(DISTINCT c.id)::bigint AS conversations,
             COUNT(m.*)::bigint AS messages
      FROM "Conversation" c
      LEFT JOIN "User" u ON u.id = c."assigneeId"
      LEFT JOIN "Message" m
        ON m."conversationId" = c.id
       AND m."senderType" = 'AGENT'
       AND m."createdAt" BETWEEN ${range.from} AND ${range.to}
      WHERE c."workspaceId" = ${workspaceId}
      GROUP BY c."assigneeId", u.name
      ORDER BY conversations DESC
    `;

    return rows.map((r) => ({
      assigneeId: r.assignee,
      name: r.name ?? 'Não atribuído',
      conversations: Number(r.conversations),
      agentMessages: Number(r.messages),
    }));
  }
}
