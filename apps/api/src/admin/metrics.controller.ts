import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DEFAULT_REPORTING_TIMEZONE, DmFlowError, startOfPeriod } from '@dmflow/shared';
import { AdminGuard } from './admin.guard';
import { RequirePlatformPermission } from './admin.decorator';
import { NoWorkspace } from '../common/decorators/permissions.decorator';
import { MetricsService, type Period } from './metrics.service';

const MAX_WINDOW_DAYS = 400;

/**
 * The numbers, and only through here.
 *
 * Every route returns the timezone and window it used alongside the figures, so
 * two people comparing screenshots can see immediately whether they were looking
 * at the same question.
 */
@NoWorkspace()
@UseGuards(AdminGuard)
@Controller('admin/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** How each figure is calculated. Fed to the interface beside the figure itself. */
  @RequirePlatformPermission('admin.metrics.read')
  @Get('definitions')
  definitions() {
    return this.metrics.definitions();
  }

  @RequirePlatformPermission('admin.metrics.read')
  @Get('revenue')
  revenue() {
    return this.metrics.revenue();
  }

  @RequirePlatformPermission('admin.metrics.read')
  @Get('growth')
  growth(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    return this.metrics.growth(resolvePeriod(from, to, tz));
  }

  @RequirePlatformPermission('admin.metrics.read')
  @Get('series')
  series(
    @Query('event') event: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tz') tz?: string,
  ) {
    if (!event) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: [{ path: 'event', message: 'Escolha qual evento a série deve contar.' }],
      });
    }
    return this.metrics.series(event, resolvePeriod(from, to, tz));
  }

  @RequirePlatformPermission('admin.metrics.read')
  @Get('cohorts')
  cohorts(@Query('months') months?: string, @Query('tz') tz?: string) {
    const back = Math.min(Math.max(Number(months) || 6, 1), 24);
    return this.metrics.cohorts(back, tz || DEFAULT_REPORTING_TIMEZONE);
  }
}

/**
 * Turns the query string into a window, or refuses it.
 *
 * A malformed date silently becoming "the last 30 days" is how somebody reads a
 * number for the wrong period and never finds out; a bad date is an error here.
 */
export function resolvePeriod(from?: string, to?: string, tz?: string): Period {
  const timeZone = tz || DEFAULT_REPORTING_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new DmFlowError('VALIDATION_FAILED', {
      details: [{ path: 'tz', message: 'Fuso horário desconhecido.' }],
    });
  }

  const end = to ? parseDay(to, 'to', timeZone, true) : new Date();
  const start = from
    ? parseDay(from, 'from', timeZone, false)
    : new Date(end.getTime() - 30 * 86_400_000);

  if (start.getTime() > end.getTime()) {
    throw new DmFlowError('VALIDATION_FAILED', {
      details: [{ path: 'from', message: 'A data inicial precisa vir antes da final.' }],
    });
  }

  if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    throw new DmFlowError('VALIDATION_FAILED', {
      details: [
        {
          path: 'from',
          message: `O período máximo é de ${MAX_WINDOW_DAYS} dias. Escolha um intervalo menor.`,
        },
      ],
    });
  }

  return { from: start, to: end, timeZone };
}

function parseDay(value: string, path: string, timeZone: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DmFlowError('VALIDATION_FAILED', {
      details: [{ path, message: 'Use o formato AAAA-MM-DD.' }],
    });
  }

  const midnight = startOfPeriod(value, timeZone);
  if (Number.isNaN(midnight.getTime())) {
    throw new DmFlowError('VALIDATION_FAILED', {
      details: [{ path, message: 'Data inválida.' }],
    });
  }

  // An inclusive end date means the whole of that day, not the instant it began.
  return endOfDay ? new Date(midnight.getTime() + 86_400_000 - 1) : midnight;
}
