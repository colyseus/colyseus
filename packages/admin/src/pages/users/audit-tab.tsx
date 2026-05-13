/**
 * "Audit" tab on the user show page — surfaces every audit-log row
 * where `target_id === <userId>` and `resource === 'users'`. Answers
 * the support question "what's been done to this user lately?"
 * without crawling the full audit log.
 *
 * Backed by Refine's `useList` against the `adminAudit` resource so
 * we get pagination, sorting, and RBAC integration for free — when
 * the operator can't read `adminAudit`, the request 403s and the
 * tab renders the access-denied note rather than a confusing empty
 * list.
 *
 * The render is a compact timeline (action chip + relative time +
 * payload preview) rather than the generic table — fewer columns
 * makes the chronological story easier to scan.
 */
import * as React from 'react';
import { useList } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2 } from 'lucide-react';
import { relativeTime, absoluteTime } from '../internals/format-cell';
import { JsonViewer } from '../internals/json-viewer';
import { AuditActionBadge } from '../internals/audit-action-badge';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

interface AuditEntry {
  id: string;
  operator_id: string | null;
  action: string;
  resource: string;
  target_id: string | null;
  payload: any;
  created_at: string | number | Date;
}

export function UserAuditTab({ userId }: { userId: string }) {
  // Filters: target_id == userId AND resource == 'users'. Only the
  // user-targeted actions (ban / unban / revoke / generic CRUD on
  // the users row) appear in this list — bans-from-rooms etc. live
  // under the room-targeted audits, which the room inspector can
  // surface separately.
  const { data, isLoading, isError, error } = useList<AuditEntry>({
    resource: 'adminAudit',
    filters: [
      { field: 'target_id', operator: 'eq', value: userId },
      { field: 'resource', operator: 'eq', value: 'users' },
    ],
    sorters: [{ field: 'created_at', order: 'desc' }],
    pagination: { current: 1, pageSize: PAGE_SIZE },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-sm">loading…</span>
      </div>
    );
  }

  if (isError) {
    // 403 is the most common failure here — mods without admin role
    // can't read the audit table. Render an explanation rather than
    // the generic error to make the cause obvious.
    const status = (error as any)?.statusCode ?? (error as any)?.response?.status;
    if (status === 403) {
      return (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          You don't have permission to read the audit log.
        </div>
      );
    }
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {(error as any)?.message ?? 'failed to load audit'}
      </div>
    );
  }

  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No audit entries for this user.
      </p>
    );
  }

  return (
    <ol className="space-y-2" data-testid="user-audit-timeline">
      {rows.map((r) => (
        <AuditRow key={r.id} entry={r} />
      ))}
    </ol>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const created = new Date(entry.created_at as any);
  const valid = !Number.isNaN(created.getTime());
  // Tolerate either shape from the API: drizzle's `mode: 'json'` text
  // columns are supposed to auto-parse, but the generic list endpoint
  // (sqlKeyedProjection) sometimes returns the raw string — handle
  // both so the chevron + preview show up regardless. `useMemo` keeps
  // the parse off the hot render path when payload is already an
  // object.
  const payload = React.useMemo(() => {
    if (typeof entry.payload === 'string') {
      try { return JSON.parse(entry.payload); } catch { return null; }
    }
    return entry.payload;
  }, [entry.payload]);
  // Audit rows have a payload only sometimes — `auth.logout`, e.g.,
  // is empty. Hide the chevron when there's nothing to reveal so the
  // affordance only appears on rows that reward expansion.
  const hasPayload = payload !== null
    && typeof payload === 'object'
    && Object.keys(payload).length > 0;
  const [expanded, setExpanded] = React.useState(false);

  // Toggle from anywhere on the row when there's a payload to reveal.
  // Operator-id link uses `stopPropagation` so clicking it navigates
  // without also flipping the expansion state.
  const toggle = () => setExpanded((v) => !v);

  return (
    <li
      className={cn(
        'rounded-md border bg-muted/30',
        // No payload to reveal → drop the affordance so the row
        // doesn't look interactive.
        hasPayload && 'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      data-testid={`audit-row-${entry.id}`}
      {...(hasPayload && {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': expanded,
        'aria-label': expanded ? 'Hide payload' : 'Show payload',
        onClick: toggle,
        onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        },
      })}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="inline-flex items-center gap-2">
          <AuditActionBadge action={entry.action} />
          {entry.operator_id && (
            <span className="text-xs text-muted-foreground">
              by{' '}
              <Link
                to={`/users/show/${entry.operator_id}`}
                className="text-primary hover:underline"
                // Keep clicks on the operator link from toggling the
                // row — navigating to the operator is its own action.
                onClick={(e) => e.stopPropagation()}
              >
                {shortId(entry.operator_id)}
              </Link>
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-2">
          <span
            className="whitespace-nowrap text-xs text-muted-foreground tabular-nums"
            title={valid ? absoluteTime(created) : undefined}
          >
            {valid ? relativeTime(created) : '—'}
          </span>
          {hasPayload && (
            // Visual-only chevron now — the whole row owns the click.
            // Kept here so the affordance is obvious on every row.
            <ChevronDown
              className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
              aria-hidden
              data-testid={`audit-row-toggle-${entry.id}`}
            />
          )}
        </div>
      </div>
      {expanded && hasPayload && (
        <div
          className="border-t px-3 py-2"
          data-testid={`audit-row-payload-${entry.id}`}
        >
          {/* Same JsonViewer the standalone /admin/adminAudit show
              page uses — keeps font + colors + theme consistent
              across both surfaces. */}
          <JsonViewer data={payload} />
        </div>
      )}
    </li>
  );
}

function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}
