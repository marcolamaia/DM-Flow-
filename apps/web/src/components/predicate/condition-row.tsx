'use client';

import * as React from 'react';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { Input, Select } from '@/components/ui/primitives';
import type { CustomField, Tag } from '@/lib/types';

/** What a single condition looks like while it is being edited. */
export interface EditableCondition {
  kind: 'condition';
  source: string;
  field: string;
  operator: string;
  value?: unknown;
}

export const EMPTY_CONDITION: EditableCondition = {
  kind: 'condition',
  source: 'tag',
  field: '',
  operator: 'is_set',
};

const SOURCES = ['tag', 'custom_field', 'contact'] as const;
const CONTACT_FIELDS = ['status', 'source', 'username', 'lastInteractionAt'] as const;
const OPERATORS = [
  'is_set',
  'is_not_set',
  'eq',
  'neq',
  'contains',
  'gt',
  'lt',
  'within_days',
] as const;

/** Operators that compare against nothing — asking for a value would be noise. */
const VALUELESS = new Set(['is_set', 'is_not_set']);

/**
 * One condition, edited.
 *
 * Written once and used by both the segment builder and the flow builder's
 * condition block. They ask the same question — "which contacts does this
 * describe?" — and two editors for it would drift the first time an operator is
 * added to one of them.
 */
export function ConditionRow({
  condition,
  tags,
  fields,
  onChange,
}: {
  condition: EditableCondition;
  tags: Tag[];
  fields: CustomField[];
  onChange: (next: EditableCondition) => void;
}) {
  const { t } = useI18n();

  const patch = (changes: Partial<EditableCondition>) =>
    onChange({ ...condition, ...changes });

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-36 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-muted">
          {t('predicate.check')}
        </span>
        <Select
          value={condition.source}
          // Changing what is being checked invalidates which field and which
          // value were chosen — keeping them would build a condition that
          // reads sensibly and matches nothing.
          onChange={(event) => patch({ source: event.target.value, field: '', value: undefined })}
        >
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {t(`predicate.source.${source}` as MessageKey)}
            </option>
          ))}
        </Select>
      </label>

      <label className="min-w-40 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-muted">
          {t('predicate.which')}
        </span>
        <Select value={condition.field} onChange={(event) => patch({ field: event.target.value })}>
          <option value="">—</option>
          {condition.source === 'tag'
            ? tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))
            : condition.source === 'custom_field'
              ? fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))
              : CONTACT_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {t(`predicate.field.${field}` as MessageKey)}
                  </option>
                ))}
        </Select>
      </label>

      <label className="min-w-36 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-muted">
          {t('predicate.operator')}
        </span>
        <Select
          value={condition.operator}
          onChange={(event) =>
            patch({
              operator: event.target.value,
              // An operator that takes no value must not carry one along.
              value: VALUELESS.has(event.target.value) ? undefined : condition.value,
            })
          }
        >
          {OPERATORS.map((operator) => (
            <option key={operator} value={operator}>
              {t(`predicate.op.${operator}` as MessageKey)}
            </option>
          ))}
        </Select>
      </label>

      {VALUELESS.has(condition.operator) ? null : (
        <label className="min-w-32 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-muted">
            {t('predicate.value')}
          </span>
          <Input
            value={String(condition.value ?? '')}
            onChange={(event) => patch({ value: event.target.value })}
          />
        </label>
      )}
    </div>
  );
}

/** True when a condition is complete enough for the server to accept it. */
export function conditionIsUsable(condition: EditableCondition): boolean {
  if (!condition.field) return false;
  if (VALUELESS.has(condition.operator)) return true;
  return String(condition.value ?? '').trim().length > 0;
}
