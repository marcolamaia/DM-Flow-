'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/primitives';

/**
 * A secret the platform will never show again.
 *
 * The whole component exists to make that unmissable. The server keeps only a
 * hash, so "I'll come back for it later" is not a thing that can work — and the
 * moment somebody discovers that is the moment their integration is already
 * broken. So the warning is not a footnote: it sits above the value, and the
 * panel does not close until the person says they have it.
 */
export function SecretOnce({
  label,
  value,
  warning,
  onDismiss,
}: {
  label: string;
  value: string;
  warning: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused. The value is on screen and selectable,
      // so failing to copy is an inconvenience, not a dead end.
    }
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
      <p className="text-[13px] font-medium text-fg">{label}</p>
      <p className="mt-1 text-[13px] text-warning">{warning}</p>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[13px]">
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t('dev.keys.copied') : t('dev.keys.copy')}
        </Button>
      </div>

      <Button size="sm" variant="ghost" className="mt-3" onClick={onDismiss}>
        {t('dev.keys.understood')}
      </Button>
    </div>
  );
}
