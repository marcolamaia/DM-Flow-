'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * O formato das páginas jurídicas.
 *
 * Deliberadamente fora do layout do aplicativo: quem lê isto muitas vezes não
 * tem conta — é alguém decidindo se cria uma, ou um contato que recebeu uma
 * mensagem e quer saber quem guarda os dados dele. Exigir sessão para ler a
 * política seria o contrário do que uma política de privacidade existe para
 * fazer.
 */
export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" />
        DM <span className="text-accent">FLOW</span>
      </Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 text-[13px] text-muted">Última atualização: {updatedAt}</p>

      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-fg">{children}</div>

      <footer className="mt-12 border-t border-border pt-6 text-[13px] text-muted">
        <div className="flex flex-wrap gap-4">
          <Link href="/privacidade" className="hover:text-fg hover:underline">
            Política de privacidade
          </Link>
          <Link href="/termos" className="hover:text-fg hover:underline">
            Termos de uso
          </Link>
        </div>
      </footer>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      {children}
    </section>
  );
}

/**
 * O que ainda precisa ser preenchido por uma pessoa.
 *
 * Marcado em amarelo em vez de deixado como texto solto: um CNPJ de exemplo
 * publicado por engano é pior do que um aviso visível.
 */
export function Preencher({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-warning/20 px-1 py-0.5 font-medium text-warning">
      [{children}]
    </mark>
  );
}
