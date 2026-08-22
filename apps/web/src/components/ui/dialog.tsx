'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './primitives';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(94vw,480px)] -translate-x-1/2 -translate-y-1/2 animate-in rounded-2xl border border-border bg-surface shadow-2xl',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-sm font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns without a description; keep it available to screen readers.
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-5 flex items-center justify-end gap-2 border-t border-border pt-4', className)}
      {...props}
    />
  );
}

/**
 * Destructive confirmation. Naming the exact object and requiring it to be typed
 * back is the difference between "are you sure?" and actually preventing the
 * accident — the user has to read what they are about to destroy.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  requireTypedName,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  requireTypedName?: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const [typed, setTyped] = React.useState('');
  const canConfirm = !requireTypedName || typed.trim() === requireTypedName.trim();

  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {requireTypedName ? (
          <div>
            <p className="mb-2 text-[13px] text-muted">
              <span className="font-mono text-fg">{requireTypedName}</span>
            </p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
              autoFocus
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant="danger" disabled={!canConfirm} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
