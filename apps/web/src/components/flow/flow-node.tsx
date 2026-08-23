'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, Image, Mic, Video, XCircle } from 'lucide-react';
import { NODE_META } from './node-meta';
import { previewOf } from './node-preview';
import { useBuilderLookups } from './builder-context';
import { cn } from '@/lib/utils';

export interface NodePort {
  /** null is the single unnamed exit. */
  id: string | null;
  label: string;
  fallback?: boolean;
}

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  label: string;
  /** Validation attached to this node, surfaced on the node itself. */
  errors?: string[];
  warnings?: string[];
  /** Live run counts, drawn as an overlay when analytics are loaded. */
  stats?: { entered: number; failed: number };
  /** Exits this node has, read from the domain rather than guessed here. */
  ports?: NodePort[];
  acceptsInput?: boolean;
  locale: string;
  config?: Record<string, unknown>;
}

/** React Flow needs a string id per handle; the unnamed exit gets a stable one. */
export const DEFAULT_HANDLE = '__next';

export const handleId = (portId: string | null): string => portId ?? DEFAULT_HANDLE;
export const portIdFromHandle = (handle: string | null | undefined): string | null =>
  !handle || handle === DEFAULT_HANDLE ? null : handle;

const MEDIA_ICON = { image: Image, video: Video, audio: Mic };

/**
 * A block shows what it does and what is wrong with it.
 *
 * Showing only the block's type would mean opening every step to find the one
 * you meant to edit — the exact tax a visual builder exists to remove. So the
 * card carries a compact version of its own content: the message text, the
 * buttons under it, how long a delay waits, which tag is applied.
 *
 * Exits come from the ports the domain declares, never from a list kept here.
 */
export const FlowNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as FlowNodeData;
  const lookups = useBuilderLookups();
  const meta = NODE_META[nodeData.nodeType];
  const Icon = meta?.icon;

  const hasError = (nodeData.errors?.length ?? 0) > 0;
  const hasWarning = (nodeData.warnings?.length ?? 0) > 0;
  const isTrigger = nodeData.nodeType === 'trigger';
  const ports = nodeData.ports ?? [];
  const acceptsInput = nodeData.acceptsInput !== false;

  const preview = previewOf(nodeData.nodeType, nodeData.config ?? {}, nodeData.locale, lookups);
  const hasBody = Boolean(preview.text || preview.chips?.length || preview.media?.length);

  // The validator and the preview often reach the same conclusion — "choose a
  // tag" — and printing it twice on one small card is noise, not emphasis.
  const notice = (hasError ? nodeData.errors : nodeData.warnings)?.[0];
  const noticeIsEcho =
    Boolean(notice && preview.text && notice.replace(/\.$/, '') === preview.text.replace(/\.$/, ''));

  // One unnamed exit sits in the corner; named exits get their own labelled row,
  // so "yes" and "no" are two visibly separate things rather than two lines
  // leaving the same point.
  const singleExit = ports.length === 1 && ports[0]!.id === null;

  return (
    <div
      className={cn(
        'w-[236px] rounded-xl border bg-surface shadow-sm transition-colors',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-border',
        // Incomplete is not the same as broken: a block still being filled in
        // gets a quieter marker than one that will fail.
        !hasError && preview.incomplete && 'border-dashed border-warning/50',
        hasError && 'border-danger/60',
        isTrigger && 'border-accent/50 bg-accent/[0.04]',
      )}
    >
      {acceptsInput ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!-top-1.5 !size-2.5 !border-2 !border-border !bg-surface"
        />
      ) : null}

      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        {Icon ? <Icon className={cn('size-3.5 shrink-0', meta.tone)} /> : null}
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
          {nodeData.label}
        </p>
      </div>

      {hasBody ? (
        <div className="px-3 pb-2.5">
          {preview.badge ? (
            <span className="mb-1 inline-block rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {preview.badge}
            </span>
          ) : null}

          {preview.text ? (
            <p
              className={cn(
                'line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-snug',
                preview.incomplete ? 'text-subtle' : 'text-fg',
              )}
            >
              {preview.text}
            </p>
          ) : null}

          {preview.media?.length ? (
            <div className="mt-1.5 flex gap-1">
              {preview.media.map((kind, index) => {
                const MediaIcon = MEDIA_ICON[kind];
                return (
                  <span
                    key={`${kind}-${index}`}
                    className="flex size-6 items-center justify-center rounded border border-border bg-elevated"
                  >
                    <MediaIcon className="size-3 text-muted" />
                  </span>
                );
              })}
            </div>
          ) : null}

          {preview.chips?.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {preview.chips.map((chip, index) => (
                <span
                  key={`${chip}-${index}`}
                  className="max-w-full truncate rounded-full border border-border px-2 py-0.5 text-[10.5px] text-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}

          {preview.detail ? (
            <p className="mt-1.5 truncate text-[11px] text-subtle">{preview.detail}</p>
          ) : null}
        </div>
      ) : preview.detail ? (
        <p className="px-3 pb-2.5 text-[11px] text-subtle">{preview.detail}</p>
      ) : (
        <div className="pb-1" />
      )}

      {(hasError || hasWarning) && !noticeIsEcho ? (
        <div
          className={cn(
            'flex items-start gap-1.5 border-t px-3 py-2',
            hasError ? 'border-danger/20 bg-danger/[0.06]' : 'border-warning/20 bg-warning/[0.06]',
          )}
        >
          {hasError ? (
            <XCircle className="mt-px size-3 shrink-0 text-danger" />
          ) : (
            <AlertTriangle className="mt-px size-3 shrink-0 text-warning" />
          )}
          <p className={cn('text-[11px] leading-snug', hasError ? 'text-danger' : 'text-warning')}>
            {notice}
          </p>
        </div>
      ) : null}

      {nodeData.stats ? (
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] tabular-nums">
          <span className="text-muted">
            {nodeData.stats.entered} {nodeData.locale === 'en' ? 'entered' : 'entraram'}
          </span>
          {nodeData.stats.failed > 0 ? (
            <span className="text-danger">
              {nodeData.stats.failed} {nodeData.locale === 'en' ? 'failed' : 'falharam'}
            </span>
          ) : null}
        </div>
      ) : null}

      {singleExit ? (
        <Handle
          type="source"
          id={DEFAULT_HANDLE}
          position={Position.Bottom}
          className="!-bottom-1.5 !size-2.5 !border-2 !border-border !bg-surface hover:!border-accent"
        />
      ) : ports.length > 0 ? (
        <div className="border-t border-border">
          {ports.map((port) => (
            <div
              key={port.id ?? DEFAULT_HANDLE}
              className={cn(
                'relative flex items-center justify-end border-b border-border/60 px-3 py-1.5 text-[11px] last:border-b-0',
                port.fallback ? 'text-subtle' : 'text-muted',
              )}
            >
              <span className="truncate">{port.label}</span>
              <Handle
                type="source"
                id={handleId(port.id)}
                position={Position.Right}
                className="!size-2.5 !border-2 !border-border !bg-surface hover:!border-accent"
                style={{ right: -5 }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
