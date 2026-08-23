'use client';

import * as React from 'react';
import type { PreviewLookups } from './node-preview';

const EMPTY: PreviewLookups = { tags: [], fields: [], members: [], automations: [] };

const BuilderLookupsContext = React.createContext<PreviewLookups>(EMPTY);

/**
 * Names for the ids a block stores.
 *
 * Delivered by context rather than copied into each node's data: tags and fields
 * load after the graph does, and a block that had baked in "tag-01a02b…" at
 * hydration time would keep showing it. Reading through context means every
 * block gets its label the moment the list arrives, without touching the graph.
 */
export function BuilderLookupsProvider({
  value,
  children,
}: {
  value: PreviewLookups;
  children: React.ReactNode;
}) {
  return <BuilderLookupsContext.Provider value={value}>{children}</BuilderLookupsContext.Provider>;
}

export function useBuilderLookups(): PreviewLookups {
  return React.useContext(BuilderLookupsContext);
}
