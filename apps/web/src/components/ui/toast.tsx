'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'rounded-xl border border-border bg-elevated text-fg text-[13px] shadow-lg',
          description: 'text-muted',
        },
      }}
    />
  );
}

export { toast };
