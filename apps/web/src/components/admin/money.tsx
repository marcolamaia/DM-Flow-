'use client';

import * as React from 'react';
import { HelpCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Card, CardBody } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { MetricDefinition, MetricRate, MoneyByCurrency } from '@/lib/types';

/**
 * Money, one line per currency.
 *
 * The API refuses to add currencies together because there is no rate to do it
 * with, so the interface shows them stacked rather than inventing a total. Two
 * currencies is a rare enough case that stacking costs nothing, and a wrong
 * total would cost a decision.
 */
export function Money({
  amounts,
  className,
}: {
  amounts: MoneyByCurrency;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const entries = Object.entries(amounts).filter(([, cents]) => cents !== 0);

  if (entries.length === 0) {
    return <span className={cn('text-muted', className)}>—</span>;
  }

  return (
    <span className={cn('flex flex-col', className)}>
      {entries.map(([currency, cents]) => (
        <span key={currency}>
          {new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)}
        </span>
      ))}
      {entries.length > 1 ? (
        <span className="text-xs font-normal text-muted">{t('admin.overview.perCurrency')}</span>
      ) : null}
    </span>
  );
}

/**
 * A rate, or an honest refusal to show one.
 *
 * The API says how many accounts a rate came from. Below the threshold the
 * percentage is not shown at all — a number that invites a decision the data
 * cannot support is worse than a blank.
 */
export function Rate({ rate }: { rate: MetricRate }) {
  const { t, locale } = useI18n();

  if (rate.value === null) return <span className="text-muted">—</span>;

  if (!rate.reliable) {
    return (
      <span className="flex flex-col">
        <span className="text-muted">
          {rate.numerator} / {rate.denominator}
        </span>
        <span className="text-xs font-normal text-muted">{t('admin.overview.unreliable')}</span>
      </span>
    );
  }

  return (
    <span>
      {new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
        rate.value,
      )}
    </span>
  );
}

/**
 * One figure, with the definition behind it one hover away.
 *
 * The wording comes from the API, which is the same place the calculation comes
 * from. A screen that wrote its own explanation could drift from what the number
 * actually is.
 */
export function Metric({
  definition,
  children,
  footnote,
}: {
  definition?: MetricDefinition;
  children: React.ReactNode;
  footnote?: string;
}) {
  const { t, locale } = useI18n();
  const key = locale === 'en' ? 'en' : 'pt-BR';

  return (
    <Card>
      <CardBody className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {definition ? definition.label[key] : ''}
          </span>
          {definition ? (
            <span
              className="shrink-0 text-muted"
              title={`${t('admin.overview.howCalculated')}: ${definition.formula[key]}${
                definition.excludes ? `\n\n${definition.excludes[key]}` : ''
              }`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </div>
        <div className="text-2xl font-semibold text-fg">{children}</div>
        {footnote ? <p className="text-xs text-muted">{footnote}</p> : null}
      </CardBody>
    </Card>
  );
}
