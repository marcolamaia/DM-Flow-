'use client';

import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Input, Label, Select, Textarea } from '@/components/ui/primitives';
import { nodeLabel } from './node-meta';
import { cn } from '@/lib/utils';
import type { Tag, CustomField } from '@/lib/types';

export interface EditableNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

/**
 * Config panel for the selected node. Every field writes straight back into the
 * graph so autosave and validation react as the operator types, rather than
 * hiding problems behind a save button.
 */
export function Inspector({
  node,
  tags,
  fields,
  members,
  automations,
  onChange,
  onDelete,
}: {
  node: EditableNode | null;
  tags: Tag[];
  fields: CustomField[];
  members: Array<{ userId: string; name: string }>;
  /** Other automations this flow may hand a contact to. */
  automations: Array<{ id: string; name: string }>;
  onChange: (config: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const { t, locale } = useI18n();

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] text-subtle">{t('builder.noSelection')}</p>
      </div>
    );
  }

  const set = (patch: Record<string, unknown>) => onChange({ ...node.config, ...patch });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <p className="text-[13px] font-medium">{nodeLabel(node.type, locale)}</p>
        {node.type !== 'trigger' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={t('builder.deleteNode')}
            title={t('builder.deleteNode')}
          >
            <Trash2 className="text-danger" />
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {node.type === 'send_message' ? (
          <MessageConfig config={node.config} set={set} />
        ) : node.type === 'delay' ? (
          <DelayConfig config={node.config} set={set} />
        ) : node.type === 'add_tag' || node.type === 'remove_tag' ? (
          <Field label={t('builder.tag')}>
            <Select
              value={String(node.config.tagId ?? '')}
              onChange={(e) => set({ tagId: e.target.value })}
            >
              <option value="">—</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : node.type === 'set_custom_field' ? (
          <>
            <Field label={t('builder.field')}>
              <Select
                value={String(node.config.customFieldId ?? '')}
                onChange={(e) => set({ customFieldId: e.target.value })}
              >
                <option value="">—</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('builder.value')} hint="{{contact.displayName}}">
              <Input
                value={String(node.config.value ?? '')}
                onChange={(e) => set({ value: e.target.value })}
              />
            </Field>
          </>
        ) : node.type === 'clear_custom_field' ? (
          <Field label={t('builder.field')}>
            <Select
              value={String(node.config.customFieldId ?? '')}
              onChange={(e) => set({ customFieldId: e.target.value })}
            >
              <option value="">—</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : node.type === 'condition' ? (
          <ConditionConfig config={node.config} set={set} tags={tags} fields={fields} />
        ) : node.type === 'assign_conversation' ? (
          <Field label={t('inbox.assign')}>
            <Select
              value={String(node.config.assigneeId ?? '')}
              onChange={(e) => set({ assigneeId: e.target.value || null })}
            >
              <option value="">{t('inbox.unassigned')}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : node.type === 'set_conversation_status' ? (
          <Field label={t('contacts.status')}>
            <Select
              value={String(node.config.status ?? 'OPEN')}
              onChange={(e) => set({ status: e.target.value })}
            >
              <option value="OPEN">{t('inbox.status.OPEN')}</option>
              <option value="SNOOZED">{t('inbox.status.SNOOZED')}</option>
              <option value="CLOSED">{t('inbox.status.CLOSED')}</option>
            </Select>
          </Field>
        ) : node.type === 'notify_team' ? (
          <Field label={t('builder.message')}>
            <Textarea
              value={String(node.config.message ?? '')}
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
        ) : node.type === 'randomizer' ? (
          <RandomizerConfig config={node.config} set={set} />
        ) : node.type === 'start_automation' ? (
          <StartAutomationConfig config={node.config} set={set} automations={automations} />
        ) : node.type === 'http_request' ? (
          <HttpConfig config={node.config} set={set} />
        ) : (
          <p className="text-[13px] text-subtle">
            {locale === 'en'
              ? 'This block needs no configuration.'
              : 'Este bloco não precisa de configuração.'}
          </p>
        )}
      </div>
    </div>
  );
}

function MessageConfig({
  config,
  set,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const blocks = (config.blocks as Array<{ type: string; text?: string }>) ?? [
    { type: 'text', text: '' },
  ];
  const quickReplies = (config.quickReplies as Array<{ id: string; title: string }>) ?? [];

  return (
    <>
      <Field label={t('builder.message')} hint="{{contact.displayName}}">
        <Textarea
          rows={5}
          value={blocks[0]?.text ?? ''}
          onChange={(e) => set({ blocks: [{ type: 'text', text: e.target.value }] })}
        />
      </Field>

      <Field label={t('builder.quickReplies')}>
        <div className="space-y-2">
          {quickReplies.map((reply, index) => (
            <div key={reply.id} className="flex gap-2">
              <Input
                value={reply.title}
                onChange={(e) => {
                  const next = [...quickReplies];
                  next[index] = { ...reply, title: e.target.value };
                  set({ quickReplies: next });
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => set({ quickReplies: quickReplies.filter((_, i) => i !== index) })}
                aria-label={t('common.delete')}
              >
                <Trash2 className="text-danger" />
              </Button>
            </div>
          ))}
          {quickReplies.length < 3 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                set({
                  quickReplies: [
                    ...quickReplies,
                    { id: `qr${Date.now().toString(36)}`, title: '' },
                  ],
                })
              }
            >
              + {t('builder.quickReplies')}
            </Button>
          ) : null}
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={Boolean(config.asPrivateReply)}
          onChange={(e) => set({ asPrivateReply: e.target.checked })}
        />
        <span>
          <span className="block text-[13px] font-medium">{t('builder.asPrivateReply')}</span>
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
            {t('builder.asPrivateReplyHint')}
          </span>
        </span>
      </label>
    </>
  );
}

function DelayConfig({
  config,
  set,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const window = (config.resumeWindow as {
    enabled: boolean;
    startHour: number;
    endHour: number;
  }) ?? { enabled: false, startHour: 8, endHour: 20 };

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <Label>{t('builder.delayAmount')}</Label>
          <Input
            type="number"
            min={1}
            value={Number(config.amount ?? 1)}
            onChange={(e) => set({ amount: Number(e.target.value) || 1 })}
          />
        </div>
        <div>
          <Label>{t('builder.delayUnit')}</Label>
          <Select
            value={String(config.unit ?? 'hours')}
            onChange={(e) => set({ unit: e.target.value })}
          >
            <option value="minutes">{t('builder.minutes')}</option>
            <option value="hours">{t('builder.hours')}</option>
            <option value="days">{t('builder.days')}</option>
          </Select>
        </div>
      </div>

      <label className="mb-3 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={window.enabled}
          onChange={(e) => set({ resumeWindow: { ...window, enabled: e.target.checked } })}
        />
        <span className="text-[13px]">{t('builder.resumeWindow')}</span>
      </label>

      {window.enabled ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={0}
            max={23}
            value={window.startHour}
            onChange={(e) =>
              set({ resumeWindow: { ...window, startHour: Number(e.target.value) } })
            }
          />
          <Input
            type="number"
            min={0}
            max={23}
            value={window.endHour}
            onChange={(e) => set({ resumeWindow: { ...window, endHour: Number(e.target.value) } })}
          />
        </div>
      ) : null}
    </>
  );
}

function ConditionConfig({
  config,
  set,
  tags,
  fields,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  tags: Tag[];
  fields: CustomField[];
}) {
  const { locale } = useI18n();
  const predicate = (config.predicate as {
    kind: string;
    source?: string;
    field?: string;
    operator?: string;
    value?: unknown;
  }) ?? { kind: 'condition', source: 'tag', field: '', operator: 'is_set' };

  const setPredicate = (patch: Record<string, unknown>) =>
    set({ predicate: { ...predicate, kind: 'condition', ...patch } });

  return (
    <>
      <Field label={locale === 'en' ? 'Check' : 'Verificar'}>
        <Select
          value={predicate.source ?? 'tag'}
          onChange={(e) => setPredicate({ source: e.target.value, field: '', value: undefined })}
        >
          <option value="tag">{locale === 'en' ? 'Tag' : 'Tag'}</option>
          <option value="custom_field">{locale === 'en' ? 'Custom field' : 'Campo'}</option>
          <option value="contact">{locale === 'en' ? 'Contact field' : 'Dado do contato'}</option>
        </Select>
      </Field>

      <Field label={locale === 'en' ? 'Which' : 'Qual'}>
        {predicate.source === 'tag' ? (
          <Select value={predicate.field ?? ''} onChange={(e) => setPredicate({ field: e.target.value })}>
            <option value="">—</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        ) : predicate.source === 'custom_field' ? (
          <Select value={predicate.field ?? ''} onChange={(e) => setPredicate({ field: e.target.value })}>
            <option value="">—</option>
            {fields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </Select>
        ) : (
          <Select value={predicate.field ?? ''} onChange={(e) => setPredicate({ field: e.target.value })}>
            <option value="">—</option>
            <option value="status">status</option>
            <option value="source">{locale === 'en' ? 'source' : 'origem'}</option>
            <option value="username">username</option>
            <option value="lastInteractionAt">
              {locale === 'en' ? 'last interaction' : 'última interação'}
            </option>
          </Select>
        )}
      </Field>

      <Field label={locale === 'en' ? 'Operator' : 'Operador'}>
        <Select
          value={predicate.operator ?? 'is_set'}
          onChange={(e) => setPredicate({ operator: e.target.value })}
        >
          <option value="is_set">{locale === 'en' ? 'is set' : 'existe'}</option>
          <option value="is_not_set">{locale === 'en' ? 'is not set' : 'não existe'}</option>
          <option value="eq">{locale === 'en' ? 'equals' : 'igual a'}</option>
          <option value="neq">{locale === 'en' ? 'not equals' : 'diferente de'}</option>
          <option value="contains">{locale === 'en' ? 'contains' : 'contém'}</option>
          <option value="gt">{locale === 'en' ? 'greater than' : 'maior que'}</option>
          <option value="lt">{locale === 'en' ? 'less than' : 'menor que'}</option>
          <option value="within_days">{locale === 'en' ? 'within days' : 'nos últimos dias'}</option>
        </Select>
      </Field>

      {!['is_set', 'is_not_set'].includes(predicate.operator ?? '') ? (
        <Field label={locale === 'en' ? 'Value' : 'Valor'}>
          <Input
            value={String(predicate.value ?? '')}
            onChange={(e) => setPredicate({ value: e.target.value })}
          />
        </Field>
      ) : null}
    </>
  );
}

function HttpConfig({
  config,
  set,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const { locale } = useI18n();
  return (
    <>
      <Field label={locale === 'en' ? 'Method' : 'Método'}>
        <Select
          value={String(config.method ?? 'POST')}
          onChange={(e) => set({ method: e.target.value })}
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="URL" hint="https://">
        <Input value={String(config.url ?? '')} onChange={(e) => set({ url: e.target.value })} />
      </Field>
      <Field label="Body (JSON)">
        <Textarea
          rows={4}
          value={String(config.body ?? '')}
          onChange={(e) => set({ body: e.target.value })}
        />
      </Field>
      <Field
        label={locale === 'en' ? 'Save response as' : 'Salvar resposta em'}
        hint={locale === 'en' ? 'Available later as {{variables.name}}' : 'Depois use {{variables.nome}}'}
      >
        <Input
          value={String(config.saveAs ?? '')}
          onChange={(e) => set({ saveAs: e.target.value })}
        />
      </Field>
    </>
  );
}


interface RandomizerPath {
  id: string;
  label: string;
  weight: number;
}

/**
 * Weighted split.
 *
 * The total is shown at all times and refuses to be wrong quietly: weights that
 * do not add up to 100 are rejected by the domain schema, so the operator has to
 * find out here rather than at publish time.
 */
function RandomizerConfig({
  config,
  set,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
}) {
  const { t, locale } = useI18n();
  const paths = (config.paths ?? []) as RandomizerPath[];
  const total = paths.reduce((sum, path) => sum + (Number(path.weight) || 0), 0);

  const update = (next: RandomizerPath[]) => set({ paths: next });

  /** Spreads 100 across the paths, giving the remainder to the first one. */
  const balance = (next: RandomizerPath[]) => {
    const share = Math.floor(100 / next.length);
    return next.map((path, index) => ({
      ...path,
      weight: index === 0 ? 100 - share * (next.length - 1) : share,
    }));
  };

  return (
    <div className="space-y-3">
      {paths.map((path, index) => (
        <div key={path.id} className="flex items-end gap-2">
          <Field label={`${t('builder.path')} ${index + 1}`} className="flex-1">
            <Input
              value={path.label}
              placeholder={String.fromCharCode(65 + index)}
              onChange={(e) =>
                update(paths.map((p) => (p.id === path.id ? { ...p, label: e.target.value } : p)))
              }
            />
          </Field>
          <Field label="%" className="w-[84px]">
            <Input
              type="number"
              min={0}
              max={100}
              value={String(path.weight)}
              onChange={(e) =>
                update(
                  paths.map((p) =>
                    p.id === path.id ? { ...p, weight: Number(e.target.value) || 0 } : p,
                  ),
                )
              }
            />
          </Field>
          {paths.length > 2 ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('common.remove')}
              onClick={() => update(balance(paths.filter((p) => p.id !== path.id)))}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          disabled={paths.length >= 10}
          onClick={() =>
            update(
              balance([
                ...paths,
                { id: `p${Date.now().toString(36)}`, label: '', weight: 0 },
              ]),
            )
          }
        >
          {t('builder.addPath')}
        </Button>
        <span
          className={cn(
            'text-[12px] tabular-nums',
            total === 100 ? 'text-muted' : 'font-medium text-danger',
          )}
        >
          {total}%{' '}
          {total !== 100 ? (locale === 'en' ? '— must be 100%' : '— precisa dar 100%') : null}
        </span>
      </div>
    </div>
  );
}

function StartAutomationConfig({
  config,
  set,
  automations,
}: {
  config: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  automations: Array<{ id: string; name: string }>;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <Field label={t('builder.automation')}>
        <Select
          value={String(config.automationId ?? '')}
          onChange={(e) => set({ automationId: e.target.value })}
        >
          <option value="">{t('builder.chooseAutomation')}</option>
          {automations.map((automation) => (
            <option key={automation.id} value={automation.id}>
              {automation.name}
            </option>
          ))}
        </Select>
      </Field>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={config.stopCurrent !== false}
          onChange={(e) => set({ stopCurrent: e.target.checked })}
        />
        <span className="text-[12.5px] leading-snug">
          {t('builder.stopCurrent')}
          <span className="mt-0.5 block text-[11.5px] text-subtle">
            {t('builder.stopCurrentHint')}
          </span>
        </span>
      </label>
    </div>
  );
}
