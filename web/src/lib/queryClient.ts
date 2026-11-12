import { QueryClient } from '@tanstack/react-query';

/** The one client of the app. A module, so that writes outside of components can keep the cache current. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
