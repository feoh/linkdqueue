import { QueryClient } from '@tanstack/svelte-query';

import type { Generation } from '../api/types';

export const ACCOUNT_QUERY_KEY = 'account' as const;

export type AccountQueryKey = readonly [
  typeof ACCOUNT_QUERY_KEY,
  Generation,
  ...ReadonlyArray<string | number | boolean | null>,
];

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });
}

export function accountQueryKey(
  generation: Generation,
  resource: string,
  ...parts: ReadonlyArray<string | number | boolean | null>
): AccountQueryKey {
  return [ACCOUNT_QUERY_KEY, generation, resource, ...parts];
}

/** Cancel and retire every authenticated read before a session changes. */
export async function retireAccountQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: [ACCOUNT_QUERY_KEY] });
  queryClient.removeQueries({ queryKey: [ACCOUNT_QUERY_KEY] });
}
