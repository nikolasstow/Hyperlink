/**
 * Pull to refresh that spins only for a pull. A page revalidates in the
 * background whenever it opens (its content is already on screen from the
 * cache); tying the spinner to that showed it on every open, pushing the page
 * down under a loader it did not need.
 *
 * @internal
 */
import * as React from "react";

export const usePullToRefresh = (refresh: () => Promise<void>): { readonly refreshing: boolean; readonly onRefresh: () => void } => {
  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = (): void => {
    setRefreshing(true);
    // The load records its own failure beside the content; the spinner
    // only needs to stop.
    void refresh().finally(() => setRefreshing(false));
  };
  return {
    refreshing,
    onRefresh,
  };
};
