'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { NODE_META } from './node-meta';
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
  summary?: string;
  /** Validation attached to this node, surfaced on the node itself. */
  errors?: string[];
  warnings?: string[];
  /** Live run counts, drawn as an overlay when analytics are loaded. */
  stats?: { entered: number; failed: number };
  /** Exits this node has, read from the domain rather than guessed here. */
  ports?: NodePort[];
  acceptsInput?: boolean;
  locale: string;
}

/** React Flow needs a string id per handle; the unnamed exit gets a stable one. */
export const DEFAULT_HANDLE = '__next';

export const handleId = (portId: string | null): string => portId ?? DEFAULT_HANDLE;
export const portIdFromHandle = (handle: string | null | undefined): string | null =>
  !handle || handle === DEFAULT_HANDLE ? null : handle;

/**
 * A node shows its own problems. Making the operator hunt through a separate error
 * list to find which block is broken is the difference between a builder that
 * teaches and one that frustrates.
 *
 * Exits are drawn from the ports the domain declares, never from a list kept here.
 * The previous version hard-coded handles for one node type, which is why the
 * branch node — whose entire purpose is several paths — had none at all.
 */
export const FlowNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as FlowNodeData;
  const meta = NODE_META[nodeData.nodeType];
  const Icon = meta?.icon;
  const hasError = (nodeData.errors?.length ?? 0) > 0;
  const hasWarning = (nodeData.warnings?.length ?? 0) > 0;
  const isTrigger = nodeData.nodeType === 'trigger';
  const ports = nodeData.ports ?? [];
  const acceptsInput = nodeData.acceptsInput !== false;

  // One unnamed exit sits in the corner; named exits get their own labelled row,
  // so "yes" and "no" are two visibly separate things rather than two lines
  // leaving the same point.
  const singleExit = ports.length === 1 && ports[0]!.id === null;

  return (
    <div
      className={cn(
        'w-[236px] rounded-xl border bg-surface shadow-sm transition-colors',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-border',
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

      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {Icon ? (
          <div className={cn('mt-0.5 shrink-0', meta.tone)}>
            <Icon className="size-4" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight">{nodeData.label}</p>
          {nodeData.summary ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">
              {nodeData.summary}
            </p>
          ) : null}
        </div>
      </div>

      {hasError || hasWarning ? (
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
            {(hasError ? nodeData.errors : nodeData.warnings)?.[0]}
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
