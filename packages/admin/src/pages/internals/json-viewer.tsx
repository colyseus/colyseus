/**
 * Read-only JSON viewer used by every place the admin renders a
 * full payload — `formatCell`'s show-mode JSON cells (cloud-saves
 * `data`, configs `value`, audit `payload`, …) and the user show
 * page's Audit-tab expanded rows. Single import site keeps the
 * font, color, theme, and bounds consistent.
 *
 * Lazy boundary: `json-edit-react` is a CJS module whose named
 * exports trip node's ESM loader. The lazy import keeps the heavy
 * dep off the test runner's eager module graph (admin tests reach
 * this file transitively through `show.tsx` / `audit-tab.tsx`).
 */
import * as React from 'react';

const JsonTreeLazy = React.lazy(() => import('./json-tree'));

/**
 * Suspense-wrapped tree view. Call this anywhere a JSON payload
 * needs to be inspected at rest — it owns the loading fallback so
 * consumers don't each write their own.
 */
export function JsonViewer({ data }: { data: unknown }) {
  return (
    <React.Suspense
      fallback={<span className="text-xs text-muted-foreground">loading…</span>}
    >
      <JsonTreeLazy data={data} />
    </React.Suspense>
  );
}
