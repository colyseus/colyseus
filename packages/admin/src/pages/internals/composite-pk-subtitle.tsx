/**
 * For composite-PK rows, decode the base64url id from the URL and render
 * a human-readable `(userId=X · slot=1)` subtitle so operators see what
 * row they're looking at without hovering the URL bar.
 *
 * Single-PK and decode-failure cases render nothing — the page heading
 * already tells them the resource and the bare id is in the URL.
 */
import { decodeCompositeId, type Resource } from '../../types';

export function CompositePkSubtitle({ def, id }: { def: Resource; id: string }) {
  if (def.primaryKey.length <= 1) { return null; }
  const values = decodeCompositeId(id);
  if (!values || values.length !== def.primaryKey.length) { return null; }
  return (
    <span
      className="ml-2 text-sm font-normal text-muted-foreground"
      data-testid="composite-pk-subtitle"
    >
      {def.primaryKey.map((col, i) => (
        <span key={col}>
          {i > 0 && <span className="mx-1.5 opacity-60">·</span>}
          <span className="font-mono">{col}</span>
          <span className="opacity-60">=</span>
          <span className="font-mono">{String(values[i])}</span>
        </span>
      ))}
    </span>
  );
}
