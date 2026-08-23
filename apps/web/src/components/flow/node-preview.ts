import { TRIGGER_DEFINITIONS, type TriggerType } from '@dmflow/shared/triggers';
import { describePredicate } from './predicate-text';

/**
 * What a block shows about itself on the canvas.
 *
 * The point of a preview is to answer "what does this step do?" without opening
 * it. A block that only says "Send message" forces the operator to click through
 * every step to find the one they meant to edit, which is exactly the tax a
 * visual builder is supposed to remove.
 */
export interface NodePreview {
  /** Small label above the content, e.g. how the message will be sent. */
  badge?: string;
  /** The block's main content, as the contact would roughly see it. */
  text?: string;
  /** Attached media, shown as small chips rather than rendered. */
  media?: Array<'image' | 'video' | 'audio'>;
  /** Buttons or quick replies offered with the message. */
  chips?: string[];
  /** Secondary line: what was chosen, how long, which field. */
  detail?: string;
  /** True when the block still needs configuring before it can run. */
  incomplete?: boolean;
}

export interface PreviewLookups {
  tags: Array<{ id: string; name: string }>;
  fields: Array<{ id: string; key: string; label?: string | null }>;
  members: Array<{ userId: string; name: string }>;
  automations: Array<{ id: string; name: string }>;
  /** Triggers attached to this automation, shown on the trigger block. */
  triggers?: Array<{ type: string; enabled: boolean; config?: Record<string, unknown> }>;
}

const EMPTY_LOOKUPS: PreviewLookups = {
  tags: [],
  fields: [],
  members: [],
  automations: [],
  triggers: [],
};

type Lang = 'pt-BR' | 'en';

const COPY = {
  'pt-BR': {
    noText: 'Sem texto ainda',
    noTrigger: 'Nenhum gatilho configurado',
    listensForNothing: 'Não espera nenhuma resposta específica',
    givesUpAfter: 'desiste depois de',
    disabled: 'desligado',
    privateReply: 'Resposta privada ao comentário',
    chooseTag: 'Escolha uma tag',
    chooseField: 'Escolha um campo',
    chooseAutomation: 'Escolha uma automação',
    chooseCondition: 'Defina a condição',
    unassign: 'Tirar responsável',
    assignTo: 'Encaminhar para',
    wait: 'Aguardar',
    until: 'Esperar até',
    onlyBetween: 'só entre',
    minutes: 'minutos',
    hours: 'horas',
    days: 'dias',
    andStop: 'e encerra esta',
    andContinue: 'e segue nesta também',
    paths: 'caminhos',
    deleted: 'apagado',
    status: { OPEN: 'Reabrir conversa', SNOOZED: 'Adiar conversa', CLOSED: 'Fechar conversa' },
  },
  en: {
    noText: 'No text yet',
    noTrigger: 'No trigger configured',
    listensForNothing: 'Listens for no particular answer',
    givesUpAfter: 'gives up after',
    disabled: 'off',
    privateReply: 'Private reply to the comment',
    chooseTag: 'Choose a tag',
    chooseField: 'Choose a field',
    chooseAutomation: 'Choose an automation',
    chooseCondition: 'Set the condition',
    unassign: 'Remove assignee',
    assignTo: 'Route to',
    wait: 'Wait',
    until: 'Wait until',
    onlyBetween: 'only between',
    minutes: 'minutes',
    hours: 'hours',
    days: 'days',
    andStop: 'and end this one',
    andContinue: 'and keep running this one too',
    paths: 'paths',
    deleted: 'deleted',
    status: { OPEN: 'Reopen conversation', SNOOZED: 'Snooze conversation', CLOSED: 'Close conversation' },
  },
} as const;

function nameOf<T extends { id: string }>(
  list: T[],
  id: unknown,
  label: (item: T) => string,
  missing: string,
): { text: string; incomplete: boolean } {
  if (typeof id !== 'string' || !id) return { text: missing, incomplete: true };
  const found = list.find((item) => item.id === id);
  // A tag that was deleted out from under a live flow has to say so, not show a
  // raw id that means nothing to anyone.
  return found ? { text: label(found), incomplete: false } : { text: missing, incomplete: true };
}

export function previewOf(
  type: string,
  config: Record<string, unknown>,
  locale: string,
  lookups: PreviewLookups = EMPTY_LOOKUPS,
): NodePreview {
  const lang: Lang = locale === 'en' ? 'en' : 'pt-BR';
  const c = COPY[lang];

  switch (type) {
    case 'trigger': {
      const triggers = lookups.triggers ?? [];
      if (triggers.length === 0) return { text: c.noTrigger, incomplete: true };

      return {
        chips: triggers.map((trigger) => {
          const definition = TRIGGER_DEFINITIONS[trigger.type as TriggerType];
          const label = definition?.label[lang] ?? trigger.type;
          return trigger.enabled ? label : `${label} (${c.disabled})`;
        }),
        // Every trigger switched off means the automation can never start, which
        // is worth saying on the block rather than only at publish time.
        incomplete: triggers.every((trigger) => !trigger.enabled),
      };
    }

    case 'send_message': {
      const blocks = (config.blocks ?? []) as Array<{ type: string; text?: string }>;
      const text = blocks.find((block) => block.type === 'text')?.text?.trim() ?? '';
      const media = blocks
        .filter((block) => block.type !== 'text')
        .map((block) => block.type as 'image' | 'video' | 'audio');
      const quickReplies = (config.quickReplies ?? []) as Array<{ title?: string }>;

      return {
        badge: config.asPrivateReply ? c.privateReply : undefined,
        text: text || c.noText,
        media: media.length > 0 ? media : undefined,
        chips: quickReplies.map((reply) => reply.title ?? '').filter(Boolean),
        incomplete: !text && media.length === 0,
      };
    }

    case 'wait_for_reply': {
      const options = (config.options ?? []) as Array<{ label?: string }>;
      const unit = String(config.timeoutUnit ?? 'days') as 'minutes' | 'hours' | 'days';

      return {
        text: options.length === 0 ? c.listensForNothing : undefined,
        chips: options.map((option, index) => option.label || `${index + 1}`),
        detail: `${c.givesUpAfter} ${config.timeoutAmount ?? 1} ${c[unit]}`,
        incomplete: options.length === 0,
      };
    }

    case 'condition': {
      const described = describePredicate(config.predicate, lang, lookups);
      return { text: described ?? c.chooseCondition, incomplete: !described };
    }

    case 'branch': {
      const branches = (config.branches ?? []) as Array<{ label?: string; predicate?: unknown }>;
      return {
        text: branches
          .map((branch, index) => branch.label || `${index + 1}`)
          .join(' · '),
        detail: `${branches.length} ${c.paths}`,
        incomplete: branches.some((branch) => !describePredicate(branch.predicate, lang, lookups)),
      };
    }

    case 'randomizer': {
      const paths = (config.paths ?? []) as Array<{ label?: string; weight?: number }>;
      const total = paths.reduce((sum, path) => sum + (Number(path.weight) || 0), 0);
      return {
        chips: paths.map(
          (path, index) => `${path.label || String.fromCharCode(65 + index)} ${path.weight ?? 0}%`,
        ),
        // Weights that do not add up are rejected by the schema, so the block has
        // to say so here rather than at publish time.
        detail: total === 100 ? undefined : `${total}% ≠ 100%`,
        incomplete: total !== 100,
      };
    }

    case 'delay': {
      if (config.mode === 'until_date') {
        const date = typeof config.untilDate === 'string' ? config.untilDate.slice(0, 16) : '';
        return { text: `${c.until} ${date.replace('T', ' ')}`, incomplete: !date };
      }

      const unit = String(config.unit ?? 'hours') as 'minutes' | 'hours' | 'days';
      const window = config.resumeWindow as { enabled?: boolean; startHour?: number; endHour?: number } | undefined;

      return {
        text: `${c.wait} ${config.amount ?? 1} ${c[unit]}`,
        detail: window?.enabled
          ? `${c.onlyBetween} ${String(window.startHour ?? 8).padStart(2, '0')}h–${String(window.endHour ?? 22).padStart(2, '0')}h`
          : undefined,
      };
    }

    case 'add_tag':
    case 'remove_tag': {
      const resolved = nameOf(lookups.tags, config.tagId, (tag) => tag.name, c.chooseTag);
      return { text: resolved.text, incomplete: resolved.incomplete };
    }

    case 'set_custom_field': {
      const resolved = nameOf(
        lookups.fields,
        config.customFieldId,
        (field) => field.label || field.key,
        c.chooseField,
      );
      const value = config.value;
      return {
        text: resolved.text,
        detail:
          value === null || value === undefined || value === ''
            ? undefined
            : `= ${String(value).slice(0, 40)}`,
        incomplete: resolved.incomplete,
      };
    }

    case 'clear_custom_field': {
      const resolved = nameOf(
        lookups.fields,
        config.customFieldId,
        (field) => field.label || field.key,
        c.chooseField,
      );
      return { text: resolved.text, incomplete: resolved.incomplete };
    }

    case 'assign_conversation': {
      if (config.assigneeId === null || config.assigneeId === '') return { text: c.unassign };
      const member = lookups.members.find((entry) => entry.userId === config.assigneeId);
      return {
        text: member ? `${c.assignTo} ${member.name}` : c.assignTo,
        incomplete: !member,
      };
    }

    case 'set_conversation_status': {
      const status = String(config.status ?? 'OPEN') as keyof typeof c.status;
      const minutes = config.snoozeMinutes;
      return {
        text: c.status[status] ?? status,
        detail: status === 'SNOOZED' && minutes ? `${minutes} ${c.minutes}` : undefined,
      };
    }

    case 'notify_team': {
      const message = String(config.message ?? '').trim();
      const members = (config.memberIds ?? []) as string[];
      return {
        text: message || undefined,
        detail: members.length > 0 ? `${members.length}` : undefined,
        incomplete: !message,
      };
    }

    case 'http_request': {
      const url = String(config.url ?? '');
      return {
        badge: String(config.method ?? 'GET'),
        text: url || undefined,
        detail: config.saveAs ? `→ {{${config.saveAs}}}` : undefined,
        incomplete: !url,
      };
    }

    case 'start_automation': {
      const resolved = nameOf(
        lookups.automations,
        config.automationId,
        (automation) => automation.name,
        c.chooseAutomation,
      );
      return {
        text: resolved.text,
        detail: config.stopCurrent === false ? c.andContinue : c.andStop,
        incomplete: resolved.incomplete,
      };
    }

    default:
      return {};
  }
}
