'use client';

import * as React from 'react';
import {
  Copy,
  LayoutGrid,
  Maximize2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/primitives';

/**
 * Canvas controls, kept to one narrow strip.
 *
 * The canvas is what the operator is looking at, so the toolbar earns its space
 * by staying out of the way: icons only, floating over the top-left corner, with
 * every action also available from a keyboard shortcut or the context menu.
 */
export function CanvasToolbar({
  canUndo,
  canRedo,
  hasSelection,
  onAdd,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onOrganise,
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onAdd: (screen: { x: number; y: number }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOrganise: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-1 shadow-sm backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('builder.addBlock')}
        title={t('builder.addBlock')}
        onClick={(event) => {
          const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
          // Opens just below the button rather than under the cursor, so the
          // catalogue never covers the control that summoned it.
          onAdd({ x: box.left, y: box.bottom + 6 });
        }}
      >
        <Plus />
      </Button>

      <Divider />

      <Button
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        aria-label={t('builder.undo')}
        title={`${t('builder.undo')} (Ctrl+Z)`}
        onClick={onUndo}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        aria-label={t('builder.redo')}
        title={`${t('builder.redo')} (Ctrl+Shift+Z)`}
        onClick={onRedo}
      >
        <Redo2 />
      </Button>

      <Divider />

      <Button
        variant="ghost"
        size="icon"
        disabled={!hasSelection}
        aria-label={t('builder.duplicate')}
        title={`${t('builder.duplicate')} (Ctrl+D)`}
        onClick={onDuplicate}
      >
        <Copy />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={!hasSelection}
        aria-label={t('builder.deleteNode')}
        title={`${t('builder.deleteNode')} (Delete)`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>

      <Divider />

      <Button
        variant="ghost"
        size="icon"
        aria-label={t('builder.organise')}
        title={t('builder.organise')}
        onClick={onOrganise}
      >
        <LayoutGrid />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('builder.zoomOut')}
        title={t('builder.zoomOut')}
        onClick={onZoomOut}
      >
        <ZoomOut />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('builder.zoomIn')}
        title={t('builder.zoomIn')}
        onClick={onZoomIn}
      >
        <ZoomIn />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('builder.fitView')}
        title={t('builder.fitView')}
        onClick={onFitView}
      >
        <Maximize2 />
      </Button>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}
