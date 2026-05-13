/**
 * Cell renderer used by ListPage and the related-table on ShowPage.
 * Routes on column type: booleans → badge, dates → relative w/ tooltip,
 * objects/JSON → truncated code, long opaque strings → copyable mono.
 *
 * When a column has `linkTo` metadata (FK to another resource) the cell is
 * wrapped in a <Link> to that resource's detail page. If a `linkLabel` is
 * provided (resolved by the list page's batched FK lookup), it overrides
 * the visible text; otherwise the cell falls back to the raw FK value
 * still wrapped in the link.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { type Column, type Resource, isBoolean, isDate, isJsonish, isNumeric } from '../../types';
import { syntheticShowPath, SYNTHETIC_SHOW_PATHS } from './synthetic-resources';
import { JsonViewer } from './json-viewer';
import { AuditActionBadge } from './audit-action-badge';

/**
 * Compact relative time for table cells, with absolute fallback for
 * older dates. Matches what the user sees in github-style "5 min ago"
 * widgets — short, no extra words.
 */
export function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const past = seconds >= 0;
  if (abs < 5) { return 'just now'; }
  if (abs < 60) { return past ? `${abs}s ago` : `in ${abs}s`; }
  const minutes = Math.round(abs / 60);
  if (minutes < 60) { return past ? `${minutes}m ago` : `in ${minutes}m`; }
  const hours = Math.round(abs / 3600);
  if (hours < 24) { return past ? `${hours}h ago` : `in ${hours}h`; }
  const days = Math.round(abs / 86_400);
  if (days < 30) { return past ? `${days}d ago` : `in ${days}d`; }
  // Older than a month — show short date `May 8`. Same year drops
  // the year suffix; cross-year keeps it (`May 8, 2025`).
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Full absolute datetime for the cell tooltip. Locale-aware. */
export function absoluteTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function safeParseJson(raw: string): any {
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Rendering mode. `'list'` (default) is the compact table cell — JSON
 * truncates to ~60 chars, long ids collapse to "xx…yy". `'show'` is
 * the detail page — JSON expands into a scrollable read-only tree
 * (audit-log payloads, cloud-saves data, configs value, etc.). Other
 * column types render identically in both modes.
 */
export type FormatMode = 'list' | 'show';

export function formatCell(
  v: any,
  c?: Column,
  linkLabel?: string,
  row?: Record<string, any>,
  resources?: Resource[],
  mode: FormatMode = 'list',
): React.ReactNode {
  if (v == null) { return <span className="text-muted-foreground">—</span>; }

  // FK columns: render as a clickable link to the target's show page.
  // Two flavors of linkTo:
  //   - Static: `linkTo.resource` is fixed at catalog build time.
  //   - Dynamic: `linkTo.resourceFromColumn` names a sibling column on
  //     the row whose VALUE is the target resource (audit-log pattern).
  //     Falls back to plain text when the resolved resource isn't in
  //     the catalog (e.g. 'auth' login events have no target page).
  if (c?.linkTo) {
    let targetResource: string | undefined = c.linkTo.resource;
    if (c.linkTo.resourceFromColumn && row) {
      const dynamic = row[c.linkTo.resourceFromColumn];
      if (typeof dynamic === 'string' && dynamic.length > 0) {
        // Accept the value if it matches a catalog resource OR a
        // synthetic surface (live-room inspector etc.). Falls back to
        // plain text when neither lookup hits — that's how `resource='auth'`
        // audit rows degrade gracefully.
        const isCatalog = !resources || resources.some((r) => r.name === dynamic);
        const isSynthetic = dynamic in SYNTHETIC_SHOW_PATHS;
        targetResource = (isCatalog || isSynthetic) ? dynamic : undefined;
      } else {
        targetResource = undefined;
      }
    }
    if (targetResource) {
      // Synthetic resources have custom show URLs (e.g. /rooms/:id
      // instead of the default /rooms/show/:id) — consult the
      // synthetic-resources map first, then fall back to the standard
      // catalog show route. Keeps the formatCell renderer agnostic to
      // which kind of resource it's linking to.
      const href = syntheticShowPath(targetResource, String(v))
        ?? `/${targetResource}/show/${encodeURIComponent(String(v))}`;
      const raw = String(v);
      const text = linkLabel ?? (raw.length > 24 && !/\s/.test(raw)
        ? `${raw.slice(0, 8)}…${raw.slice(-4)}`
        : raw);
      return (
        <Link
          to={href}
          className="text-primary hover:underline"
          title={linkLabel ? raw : undefined}
          data-testid={`fk-link-${c.name}`}
        >
          {text}
        </Link>
      );
    }
    // Dynamic linkTo with no resolvable target — fall through to the
    // default plain-text renderer below.
  }

  // Categorical action / event name badge — applied to:
  //   - `action` columns unconditionally (audit log: `user.ban`,
  //     `update`, etc. — the CRUD-verb case has no dot, so we can't
  //     pattern-match it),
  //   - `name` columns whose value matches the dotted-event shape
  //     (`analyticsEvents.name`: `room.join`, `level.completed`).
  //
  // The strict regex (`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`) avoids
  // false positives on emails, file paths, semver, etc. that also
  // contain dots — only identifier-like dotted lowercase strings
  // qualify. Custom resources with an `action` column inherit the
  // styling for free; everyone else is unaffected.
  if (c && typeof v === 'string') {
    const isActionColumn = c.name === 'action';
    const isDottedEventName = c.name === 'name'
      && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(v);
    if (isActionColumn || isDottedEventName) {
      return <AuditActionBadge action={v} />;
    }
  }

  if (c && isBoolean(c)) {
    const b = v === true || v === 1 || v === '1' || v === 'true';
    return <Badge variant={b ? 'success' : 'secondary'}>{b ? 'Yes' : 'No'}</Badge>;
  }

  if (c && isDate(c)) {
    const d = v instanceof Date ? v : new Date(v);
    if (!isNaN(d.getTime())) {
      return <span className="whitespace-nowrap" title={absoluteTime(d)}>{relativeTime(d)}</span>;
    }
    return String(v);
  }

  if (c && isNumeric(c) && typeof v === 'number') {
    return (
      <span className="tabular-nums">
        {Number.isInteger(v) ? v.toLocaleString() : v.toString()}
      </span>
    );
  }

  if (typeof v === 'object' || (c && isJsonish(c) && typeof v === 'string')) {
    const obj = typeof v === 'string' ? safeParseJson(v) : v;
    // Show pages use the collapsible tree view — much friendlier than
    // a 60-char preview when the operator's whole reason to be on
    // this page is to read the payload (audit log, cloud save, etc.).
    // List/table cells stay compact: the truncated <code> + tooltip
    // is the right density for a table row.
    if (mode === 'show') {
      return <JsonViewer data={obj} />;
    }
    const json = JSON.stringify(obj);
    return (
      <code
        className="text-xs text-muted-foreground"
        title={JSON.stringify(obj, null, 2)}
      >
        {json.slice(0, 60)}{json.length > 60 ? '…' : ''}
      </code>
    );
  }

  const s = String(v);
  if (s.length > 24 && !/\s/.test(s)) {
    return (
      <span
        className="font-mono text-xs cursor-pointer"
        title={s}
        onClick={() => { navigator.clipboard.writeText(s).catch(() => {}); }}
      >
        {s.slice(0, 8)}…{s.slice(-4)}
      </span>
    );
  }

  return s;
}
