'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { NODE_META } from './node-meta';
import { cn } from '@/lib/utils';

export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  label: string;
  summary?: string;
  /** Validation attached to this node, surfaced on the node itself. */
  errors?: string[];
  warnings?: string[];
  /** Live run counts, drawn as an overlay when analytics are loaded. */
  stats?: { entered: number; failed: number };
  handles?: string[];
  locale: string;
}

/**
 * A node shows its own problems. Making the operator hunt through a separate error
 * list to find which block is broken is the difference between a builder that
 * teaches and one that frustrates.
 */
export const FlowNode = memo(({ data, selected, type }: NodeProps) => {
  const nodeData = data as FlowNodeData;
  const meta = NODE_META[nodeData.nodeType];
  const Icon = meta?.icon;
  const hasError = (nodeData.errors?.length ?? 0) > 0;
  const hasWarning = (nodeData.warnings?.length ?? 0) > 0;
  const isTrigger = nodeData.nodeType === 'trigger';
  const isTerminal = nodeData.nodeType === 'end';
  const handles = nodeData.handles ?? [];

  return (
    <div
      className={cn(
        'w-[236px] rounded-xl border bg-surface shadow-sm transition-colors',
        selected ? 'border-accent ring-2 ring-accent/20' : 'border-border',
        hasError && 'border-danger/60',
      )}
    >
      {!isTrigger ? (
        <Handle type="target" position={Position.Top} className="!-top-1.5" />
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

      {!isTerminal ? (
        handles.length > 0 ? (
          <div className="relative h-6 border-t border-border">
            {handles.map((handle, index) => (
              <div
                key={handle}
                className="absolute -bottom-1.5"
                style={{ left: `${((index + 1) / (handles.length + 1)) * 100}%` }}
              >
                <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] text-subtle">
                  {handle === 'true'
                    ? nodeData.locale === 'en'
                      ? 'yes'
                      : 'sim'
                    : handle === 'false'
                      ? nodeData.locale === 'en'
                        ? 'no'
                        : 'não'
                      : handle}
                </span>
                <Handle
                  type="source"
                  position={Position.Bottom}
                  id={handle}
                  style={{ position: 'relative', left: 0, transform: 'translateX(-50%)' }}
                />
              </div>
            ))}
          </div>
        ) : (
          <Handle type="source" position={Position.Bottom} className="!-bottom-1.5" />
        )
      ) : null}
    </div>
  );
});

FlowNode.displayName = 'FlowNode';
