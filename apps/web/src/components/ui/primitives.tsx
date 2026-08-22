'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

// ── Button ───────────────────────────────────────────────────

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent/90',
        secondary: 'bg-elevated text-fg border border-border hover:bg-border/40',
        ghost: 'text-muted hover:bg-elevated hover:text-fg',
        danger: 'bg-danger text-white hover:bg-danger/90',
        outline: 'border border-border text-fg hover:bg-elevated',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Spinner className="size-4" /> : null}
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

// ── Input / Textarea / Select ────────────────────────────────

const fieldClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle transition-colors focus:border-accent focus:outline-none focus-visible:outline-none disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClass, 'h-9', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldClass, 'min-h-[80px] resize-y', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClass, 'h-9 cursor-pointer pr-8', className)} {...props} />
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-[13px] font-medium text-muted', className)} {...props} />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4', className)}>
      {label ? <Label>{label}</Label> : null}
      {children}
      {hint && !error ? <p className="mt-1.5 text-xs text-subtle">{hint}</p> : null}
      {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-surface', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-fg', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

// ── Badge ────────────────────────────────────────────────────

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-elevated text-muted border border-border',
        accent: 'bg-accent/10 text-accent border border-accent/20',
        success: 'bg-success/10 text-success border border-success/20',
        warning: 'bg-warning/10 text-warning border border-warning/20',
        danger: 'bg-danger/10 text-danger border border-danger/20',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// ── Feedback states ──────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Skeletons match the final layout so the page does not jump when data lands. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-3 text-subtle [&_svg]:size-7">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[13px] text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  correlationId,
  onRetry,
  retryLabel,
}: {
  message: string;
  correlationId?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="max-w-md text-sm text-fg">{message}</p>
      {correlationId ? (
        // Shown deliberately: it is what lets support trace the exact request.
        <p className="mt-2 font-mono text-[11px] text-subtle">{correlationId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel ?? 'Retry'}
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({
  tone = 'warning',
  title,
  children,
  action,
}: {
  tone?: 'warning' | 'danger' | 'accent' | 'success';
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const tones = {
    warning: 'border-warning/30 bg-warning/10',
    danger: 'border-danger/30 bg-danger/10',
    accent: 'border-accent/30 bg-accent/10',
    success: 'border-success/30 bg-success/10',
  };
  const titleTone = {
    warning: 'text-warning',
    danger: 'text-danger',
    accent: 'text-accent',
    success: 'text-success',
  };
  return (
    <div className={cn('rounded-xl border px-4 py-3', tones[tone])} role="status">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={cn('text-[13px] font-semibold', titleTone[tone])}>{title}</p>
          {children ? <div className="mt-1 text-[13px] text-fg/80">{children}</div> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: number;
}) {
  const label = (name ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ''}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-elevated text-[11px] font-semibold text-muted"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {label}
    </div>
  );
}
