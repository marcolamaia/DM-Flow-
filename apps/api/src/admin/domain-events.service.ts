import { Injectable } from '@nestjs/common';
import { uuidv7, type DomainEventInput } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { logger } from '../common/logger';

/**
 * Records what happened, so the panel can answer questions about the past.
 *
 * Writing an event never fails the thing it describes. A payment that went
 * through did go through, whether or not we managed to write the line about it —
 * refusing the payment to protect the log would have the priorities backwards.
 * A failed write is logged loudly instead, because a gap in the history is a real
 * problem, just a smaller one than a refused payment.
 */
@Injectable()
export class DomainEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: DomainEventInput): Promise<void> {
    try {
      await this.prisma.domainEvent.create({
        data: {
          id: uuidv7(),
          event: input.event,
          workspaceId: input.workspaceId ?? null,
          userId: input.userId ?? null,
          actorUserId: input.actorUserId ?? null,
          amountCents: input.amountCents ?? null,
          currency: input.currency ?? null,
          properties: (input.properties ?? {}) as never,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), event: input.event },
        'failed to record domain event',
      );
    }
  }

  /**
   * Records several facts at once.
   *
   * Used where one action produces a burst — a subscription starting is also a
   * payment succeeding — so the panel does not see them arrive seconds apart.
   */
  async recordMany(inputs: DomainEventInput[]): Promise<void> {
    if (inputs.length === 0) return;

    try {
      await this.prisma.domainEvent.createMany({
        data: inputs.map((input) => ({
          id: uuidv7(),
          event: input.event,
          workspaceId: input.workspaceId ?? null,
          userId: input.userId ?? null,
          actorUserId: input.actorUserId ?? null,
          amountCents: input.amountCents ?? null,
          currency: input.currency ?? null,
          properties: (input.properties ?? {}) as never,
          occurredAt: input.occurredAt ?? new Date(),
        })),
      });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error), count: inputs.length },
        'failed to record domain events',
      );
    }
  }
}
