'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardList, CreditCard, LayoutDashboard, Users, Wallet, Webhook } from 'lucide-react';
import { get } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { Badge, EmptyState, Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { AdminMe } from '@/lib/types';

const NAV: Array<{
  href: string;
  label: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  permission: string;
}> = [
  { href: '/admin', label: 'admin.nav.overview', icon: LayoutDashboard, permission: 'admin.metrics.read' },
  { href: '/admin/users', label: 'admin.nav.users', icon: Users, permission: 'admin.users.read' },
  {
    href: '/admin/subscriptions',
    label: 'admin.nav.subscriptions',
    icon: CreditCard,
    permission: 'admin.subscriptions.read',
  },
  {
    href: '/admin/finance',
    label: 'admin.nav.finance',
    icon: Wallet,
    permission: 'admin.billing.read',
  },
  {
    href: '/admin/webhooks',
    label: 'admin.nav.webhooks',
    icon: Webhook,
    permission: 'admin.billing.read',
  },
  { href: '/admin/audit', label: 'admin.nav.audit', icon: ClipboardList, permission: 'admin.audit.read' },
];

/**
 * The administrative shell.
 *
 * Deliberately outside the tenant layout: an admin here is looking across every
 * account, so a workspace switcher would be meaningless and a workspace header
 * would be a lie.
 *
 * The navigation is filtered by what the role actually carries, so nobody is
 * offered a screen that will refuse them. That is a courtesy, not the
 * protection — the server decides, and it decides again on every request.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  const me = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => get<AdminMe>('/admin/me'),
    retry: false,
  });

  if (me.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-muted" />
      </div>
    );
  }

  // The API answers 404 rather than 403 for somebody with no grant, so this
  // screen says the same thing: nothing about whether the area exists.
  if (me.isError || !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          title={t('admin.noAccess')}
          action={
            <Link href="/dashboard" className="text-sm text-accent hover:underline">
              {t('admin.backToApp')}
            </Link>
          }
        />
      </div>
    );
  }

  const permissions = new Set(me.data.permissions);
  const visible = NAV.filter((item) => permissions.has(item.permission));

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-fg">{t('admin.title')}</p>
          <div className="mt-2">
            <Badge tone="accent">{me.data.role}</Badge>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {visible.map((item) => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  active ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-elevated hover:text-fg',
                )}
              >
                <item.icon className="h-4 w-4" />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('admin.backToApp')}
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
