'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { get } from '@/lib/api';
import type { Me } from '@/lib/types';
import { Spinner } from '@/components/ui/primitives';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((me) => router.replace(me.workspaces.length > 0 ? '/dashboard' : '/login'))
      .catch(() => router.replace('/login'));
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner className="size-6 text-muted" />
    </div>
  );
}
