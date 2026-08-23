import * as React from 'react';

const DAY_MS = 86_400_000;

/**
 * A data de N dias atrás, lida só no navegador.
 *
 * `Date.now()` durante a renderização é lido duas vezes: uma quando o Next gera
 * o HTML e outra quando o navegador hidrata a tela. Nada garante que as duas
 * caiam no mesmo dia — e numa página gerada no build, nem no mesmo mês. O
 * resultado seria um período que ninguém escolheu, sem nada no log dizendo
 * por quê.
 *
 * Ler o relógio depois que a tela montou elimina a dúvida: existe um único
 * valor, e é o do relógio de quem está olhando.
 *
 * Devolve `null` na primeira renderização. Quem usa deve segurar a consulta até
 * ter a data, em vez de consultar um período inventado.
 */
export function useDaysAgo(days: number): string | null {
  const [from, setFrom] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFrom(new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10));
  }, [days]);

  return from;
}
