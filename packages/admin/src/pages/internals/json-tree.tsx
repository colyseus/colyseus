/**
 * Read-only JSON tree view used by the show-page cell renderer for
 * JSON-typed columns (audit-log `payload`, cloud-saves `data`,
 * configs `value`, etc.).
 *
 * Why not reuse the CodeMirror `JsonEditor` from
 * `@/components/ui/json-editor`: that one is the *edit* widget —
 * great for the edit form's monospace block input, terrible for
 * scanning a 200-key payload at rest. This one is `viewOnly: true`,
 * collapsible, and follows the panel's light/dark theme.
 *
 * The component is intentionally thin — it wraps `json-edit-react`
 * with our defaults so callers don't have to import the library or
 * decide on theme + height bounds at every call site.
 */
import * as React from 'react';
import { JsonEditor, githubDarkTheme, githubLightTheme } from 'json-edit-react';
import { useTheme } from '@/lib/theme-provider';

// Default export so `format-cell.tsx` can wire this with
// `React.lazy(() => import('./json-tree'))` — that lazy boundary is
// what keeps `json-edit-react` (a CJS module whose named exports
// trip node's ESM loader) off the eager-import path that the
// test runner traverses.
export default function JsonTree({ data }: { data: unknown }) {
  const { resolved: themeMode } = useTheme();
  return (
    // max-h + overflow-auto: large audit payloads / cloud-save blobs
    // shouldn't push the rest of the show page off the screen. The
    // tree scrolls inside its own pane; the surrounding `<dd>`
    // stretches to fit but no further.
    <div className="rounded-md border bg-muted/40 p-2 text-xs max-h-[60vh] overflow-auto">
      <JsonEditor
        data={data as any}
        rootName=""
        viewOnly
        theme={themeMode === 'dark' ? githubDarkTheme : githubLightTheme}
      />
    </div>
  );
}
