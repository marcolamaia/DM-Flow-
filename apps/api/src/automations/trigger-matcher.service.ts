import { Injectable } from '@nestjs/common';
import {
  TRIGGER_DEFINITIONS,
  matchesKeywords,
  type KeywordMatchConfig,
  type NormalizedEvent,
  type TriggerType,
} from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface MatchCandidate {
  triggerId: string;
  automationId: string;
  automationVersionId: string;
  type: TriggerType;
  priority: number;
  specificity: number;
  createdAt: Date;
  isCatchAll: boolean;
}

export interface MatchOutcome {
  selected: MatchCandidate | null;
  /** Triggers that matched but did not win, so the operator can debug misfires. */
  alsoMatched: MatchCandidate[];
  /** Triggers considered and rejected, with the reason. */
  rejected: Array<{ triggerId: string; reason: string }>;
}

const EVENT_TO_TRIGGERS: Record<string, TriggerType[]> = {
  message_received: ['ig_dm_keyword', 'ig_dm_default'],
  comment_created: ['ig_comment'],
  story_reply: ['ig_story_reply', 'ig_dm_default'],
  story_mention: ['ig_story_mention'],
};

@Injectable()
export class TriggerMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Picks the one trigger that should run for an event.
   *
   * Ordering is specificity, then explicit priority, then creation time. Never
   * random: "why did this flow fire instead of that one?" has to have the same
   * answer every time, or the operator cannot reason about their own automations.
   */
  async match(
    workspaceId: string,
    connectedAccountId: string,
    event: NormalizedEvent,
  ): Promise<MatchOutcome> {
    const types = EVENT_TO_TRIGGERS[event.type] ?? [];
    if (types.length === 0) return { selected: null, alsoMatched: [], rejected: [] };

    const triggers = await this.prisma.trigger.findMany({
      where: {
        workspaceId,
        type: { in: types },
        enabled: true,
        OR: [{ connectedAccountId }, { connectedAccountId: null }],
        automation: { status: 'PUBLISHED', deletedAt: null },
      },
      include: { automation: { select: { publishedVersionId: true, status: true } } },
    });

    const rejected: Array<{ triggerId: string; reason: string }> = [];
    const matched: MatchCandidate[] = [];

    for (const trigger of triggers) {
      // Only triggers belonging to the currently published version may fire.
      if (trigger.automationVersionId !== trigger.automation.publishedVersionId) {
        rejected.push({ triggerId: trigger.id, reason: 'trigger_belongs_to_older_version' });
        continue;
      }

      const definition = TRIGGER_DEFINITIONS[trigger.type as TriggerType];
      if (!definition) {
        rejected.push({ triggerId: trigger.id, reason: 'unknown_trigger_type' });
        continue;
      }

      const evaluation = this.evaluate(trigger.type as TriggerType, trigger.config as never, event);
      if (!evaluation.matched) {
        rejected.push({ triggerId: trigger.id, reason: evaluation.reason });
        continue;
      }

      matched.push({
        triggerId: trigger.id,
        automationId: trigger.automationId,
        automationVersionId: trigger.automationVersionId,
        type: trigger.type as TriggerType,
        priority: trigger.matchPriority,
        specificity: evaluation.specificity,
        createdAt: trigger.createdAt,
        isCatchAll: definition.isCatchAll,
      });
    }

    if (matched.length === 0) return { selected: null, alsoMatched: [], rejected };

    // A catch-all only wins when nothing specific matched, whatever its priority.
    const specific = matched.filter((m) => !m.isCatchAll);
    const pool = specific.length > 0 ? specific : matched;

    pool.sort(
      (a, b) =>
        b.specificity - a.specificity ||
        b.priority - a.priority ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const [selected, ...rest] = pool;
    const alsoMatched = [...rest, ...(specific.length > 0 ? matched.filter((m) => m.isCatchAll) : [])];

    return { selected: selected ?? null, alsoMatched, rejected };
  }

  private evaluate(
    type: TriggerType,
    config: Record<string, unknown>,
    event: NormalizedEvent,
  ): { matched: boolean; specificity: number; reason: string } {
    switch (type) {
      case 'ig_dm_default':
        return { matched: true, specificity: 0, reason: '' };

      case 'ig_dm_keyword':
      case 'ig_story_reply': {
        const text = event.text ?? '';
        if (!text) return { matched: false, specificity: 0, reason: 'event_has_no_text' };
        const kw = config as unknown as KeywordMatchConfig;
        const ok = matchesKeywords(text, kw);
        // A keyword list is more specific than "any message".
        const specificity = kw.includeKeywords?.length ? 20 : 5;
        return { matched: ok, specificity, reason: ok ? '' : 'keywords_did_not_match' };
      }

      case 'ig_comment': {
        const kw = config as unknown as KeywordMatchConfig & { mediaIds?: string[] };
        const mediaIds = kw.mediaIds ?? [];
        const mediaId = event.comment?.mediaId;

        if (mediaIds.length > 0 && (!mediaId || !mediaIds.includes(mediaId))) {
          return { matched: false, specificity: 0, reason: 'comment_on_different_media' };
        }

        const text = event.text ?? '';
        const ok = matchesKeywords(text, kw);
        // Targeting a specific post beats a keyword, which beats "any comment".
        const specificity = (mediaIds.length > 0 ? 30 : 0) + (kw.includeKeywords?.length ? 20 : 5);
        return { matched: ok, specificity, reason: ok ? '' : 'keywords_did_not_match' };
      }

      case 'ig_story_mention':
        return { matched: true, specificity: 10, reason: '' };

      default:
        return { matched: false, specificity: 0, reason: 'trigger_not_event_driven' };
    }
  }
}
