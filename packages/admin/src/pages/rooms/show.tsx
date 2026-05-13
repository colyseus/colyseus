/**
 * Room inspector — drilling into a single live room. Polls
 * `GET /admin-api/rooms/:roomId` and renders:
 *
 *   - top stat strip (clients, locked, elapsed, stateSize)
 *   - state tree (collapsible) with inline leaf-edit + key-delete,
 *     mutations routed through `/admin-api/rooms/:roomId/state`
 *     and recorded in the audit log
 *   - clients table with per-row Kick (audited)
 *   - dispose-room action (audited)
 *
 * Mutation flows show a confirm dialog before firing — both kick and
 * dispose are irreversible. Failures surface as a toast.
 */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loader2, Trash2, User, Lock, Unlock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { JsonEditor, githubDarkTheme, githubLightTheme } from 'json-edit-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Page } from '@/components/ui/page';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { KickConfirmDialog } from '../internals/kick-confirm-dialog';
import { useTheme } from '@/lib/theme-provider';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 2000;

interface InspectorView {
  roomId: string;
  name: string;
  clients: number;
  /** `null` over the wire for `Infinity` (JSON.stringify quirk). */
  maxClients: number | null;
  locked: boolean;
  elapsedTime: number;
  metadata: any;
  clientList: Array<{
    sessionId: string;
    userId: string | null;
    /** Resolved from the users table when present; null when the user has
     *  no email on file (e.g. anonymous-but-promoted users, OAuth providers
     *  that didn't supply an email). */
    userEmail?: string | null;
    elapsedTime: number;
  }>;
  state: any;
  stateSize: number;
}

export function RoomShowPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [view, setView] = React.useState<InspectorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Ref so the state-editor can trigger a one-shot fetch right after
  // a mutation without waiting up to POLL_INTERVAL_MS for the next
  // tick. The closure is rebuilt on each effect run; the ref keeps
  // the StateEditor's prop stable.
  const refreshNowRef = React.useRef<() => void>(() => {});
  const refreshNow = React.useCallback(() => refreshNowRef.current(), []);
  // Suspend polling while the user is mid-edit in the State tree —
  // otherwise the 2s tick can replace the field's value out from
  // under their keystrokes. The StateEditor toggles this ref via
  // json-edit-react's onEditEvent. Ref (not state) keeps the
  // interval's closure stable AND avoids re-rendering the entire
  // page on every focus/blur.
  const isEditingRef = React.useRef(false);
  const setIsEditing = React.useCallback((v: boolean) => { isEditingRef.current = v; }, []);
  // Sessions whose kick request is in-flight. Renders the row faded +
  // hides the kick button so the operator gets immediate visual
  // feedback rather than waiting ~2s for the next poll to drop the
  // row. On failure we remove the id from this set; on success the
  // row disappears naturally when the poll refreshes.
  const [pendingKicks, setPendingKicks] = React.useState<ReadonlySet<string>>(() => new Set());
  // Search query for the state tree. Lifted to the page (not local
  // to StateEditor) so the Clients table can populate it when an
  // operator clicks a sessionId — the common "where is this client
  // referenced in the room state?" question becomes one click.
  const [stateSearch, setStateSearch] = React.useState('');
  const stateSearchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!roomId) { return; }
    let cancelled = false;
    let timer: number | undefined;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`/admin-api/rooms/${roomId}`, { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 404) {
            setError('Room is no longer active.');
            if (timer) { window.clearInterval(timer); }
            return;
          }
          setError(`HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setView(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) { setError(err?.message ?? 'failed to load room'); }
      }
    };

    // refreshNow always fires (manual user-initiated post-mutation
    // refresh), but the polled tick skips while a field is being
    // edited so we don't trash the operator's in-progress input.
    refreshNowRef.current = () => { void fetchOnce(); };
    void fetchOnce();
    timer = window.setInterval(() => {
      if (isEditingRef.current) { return; }
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) { window.clearInterval(timer); } };
  }, [roomId]);

  /**
   * Set of strings that appear as object keys anywhere in the state
   * tree. Used to mark sessionIds in the Clients table that are
   * referenced by state — a quick "this player is tracked in state"
   * affordance without forcing the operator to search to find out.
   *
   * Recomputed only when the state object reference changes (every
   * poll tick produces a new reference). For pathological state
   * sizes we bail early; the indicator is non-load-bearing.
   */
  const stateKeys = React.useMemo<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    const MAX_NODES = 50000; // soft cap — bail on absurdly large trees
    let visited = 0;
    function walk(node: unknown): void {
      if (visited >= MAX_NODES) { return; }
      if (!node || typeof node !== 'object') { return; }
      if (Array.isArray(node)) {
        for (const v of node) { visited++; walk(v); }
        return;
      }
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visited++;
        out.add(k);
        walk(v);
      }
    }
    walk(view?.state);
    return out;
  }, [view?.state]);

  /**
   * Wire the Clients table's sessionId cells to the state-tree search.
   * Sets the search box value, then scrolls + focuses it so the
   * operator gets a clear visual confirmation that the query landed.
   * Wrapped in `requestAnimationFrame` so the focus call runs after
   * React has rendered the controlled input with the new value.
   */
  function findInState(query: string): void {
    setStateSearch(query);
    requestAnimationFrame(() => {
      const el = stateSearchInputRef.current;
      if (!el) { return; }
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      el.focus();
      el.select();
    });
  }

  async function kick(sessionId: string, reason?: string) {
    if (!roomId) { return; }
    // Optimistic UX: mark the row pending immediately so the operator
    // sees feedback. We DON'T set the global `busy` flag here — kicks
    // are per-row, and globally disabling Dispose / Lock for a kick is
    // misleading. Failures roll the row back out of the pending set.
    setPendingKicks((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
    try {
      const trimmed = reason?.trim();
      const res = await fetch(
        `/admin-api/rooms/${roomId}/clients/${sessionId}`,
        {
          method: 'DELETE', credentials: 'include',
          // Only send a body when there's a reason — keeps DELETEs
          // body-less by default for HTTP intermediaries that drop
          // bodies on DELETE requests.
          ...(trimmed ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: trimmed }),
          } : {}),
        },
      );
      if (!res.ok) { throw new Error(`kick failed (HTTP ${res.status})`); }
      toast.success(`Kicked ${sessionId}`);
      // Force a refresh so the row drops without waiting for the next
      // poll tick. On success we leave the id in `pendingKicks` — the
      // row is about to disappear anyway, and clearing it now would
      // briefly un-fade before the row dies.
      refreshNow();
    } catch (err: any) {
      toast.error(err?.message ?? 'kick failed');
      setPendingKicks((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function dispose() {
    if (!roomId) { return; }
    setBusy(true);
    try {
      const res = await fetch(`/admin-api/rooms/${roomId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) { throw new Error(`dispose failed (HTTP ${res.status})`); }
      toast.success(`Room ${roomId} disposed`);
      navigate('/rooms');
    } catch (err: any) {
      toast.error(err?.message ?? 'dispose failed');
      setBusy(false);
    }
  }

  async function toggleLock(nextLocked: boolean) {
    if (!roomId) { return; }
    setBusy(true);
    try {
      const res = await fetch(`/admin-api/rooms/${roomId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locked: nextLocked }),
      });
      if (!res.ok) { throw new Error(`${nextLocked ? 'lock' : 'unlock'} failed (HTTP ${res.status})`); }
      toast.success(`Room ${nextLocked ? 'locked' : 'unlocked'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'lock toggle failed');
    } finally {
      setBusy(false);
    }
  }

  if (!view && !error) {
    return (
      <Page title={`Room ${roomId}`} back="/rooms">
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="ml-2 text-sm">loading…</span>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          <span>{view?.name ?? roomId}</span>
          <span className="font-mono text-sm text-muted-foreground">{view?.roomId}</span>
        </span>
      }
      back="/rooms"
      actions={
        view && (
          <div className="flex items-center gap-2">
            {/* Lock toggle moved into the "Locked status" stat tile —
                the tile *is* the affordance, so we don't need a
                duplicate button here. Dispose stays as the only
                header action so destructive operations are visually
                distinct from view/toggle controls. */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={busy} data-testid="dispose-room">
                <Trash2 className="mr-1 size-4" />
                Dispose room
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Dispose this room?</AlertDialogTitle>
                <AlertDialogDescription>
                  All {view.clients} client{view.clients === 1 ? '' : 's'} will be disconnected and the
                  room will be removed from the matchmaker. This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={dispose} data-testid="dispose-confirm">
                  Dispose
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </div>
        )
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {view && (
        <>
          {/* Top stats strip */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Clients" value={`${view.clients} / ${formatMaxClients(view.maxClients)}`} />
            <Stat
              label="Locked status"
              hint={view.locked ? 'Click to unlock' : 'Click to lock'}
              testid={view.locked ? 'unlock-room' : 'lock-room'}
              disabled={busy}
              onClick={() => toggleLock(!view.locked)}
              value={
                <span className="inline-flex items-center gap-1.5">
                  {view.locked
                    ? <Lock className="size-4" aria-hidden />
                    : <Unlock className="size-4" aria-hidden />}
                  <span>{view.locked ? 'locked' : 'unlocked'}</span>
                </span>
              }
            />
            <Stat label="Uptime" value={formatDuration(view.elapsedTime)} />
            <Stat label="State size" value={`${view.stateSize} B`} />
          </div>

          {/*
            Two-column layout on wide screens: Clients (left, narrower
            1fr — operators ask "who's here?" first, and kick lives
            here so it earns the primary reading position) and State
            (right, wider 2fr — the JSON tree benefits from horizontal
            room). Stacks vertically on small/medium where there isn't
            room to split. `min-w-0` on each cell stops a long
            sessionId or state value from blowing out the grid's
            column.

            Clients uses `lg:sticky lg:top-4 lg:self-start`: the
            self-start prevents grid-stretch on the column so sticky
            has somewhere to "stick" within. State scrolls
            independently inside its own pane (see StateEditor), so a
            big state tree never pushes the Kick controls off-screen.
          */}
          {/* Equal-width columns on wide screens. State values wrap
              to a new line at narrow widths anyway, so giving it
              extra horizontal room didn't pay off — and the Clients
              table desperately needed the breathing room. 50/50
              keeps both columns balanced and predictable regardless
              of viewport size above the `lg` breakpoint. */}
          <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
            <Section
              title={
                <span className="inline-flex items-baseline gap-2">
                  <span>Clients</span>
                  {/* Count badge so the operator gets the population
                      size instantly without scanning rows or
                      consulting the top stat strip. */}
                  <span
                    data-testid="clients-count"
                    className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-muted-foreground"
                  >
                    {view.clientList.length}
                  </span>
                </span>
              }
              testid="section-clients"
              className="mt-0 min-w-0 lg:sticky lg:top-4 lg:self-start"
            >
              {view.clientList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clients connected.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Joined</TableHead>
                      <TableHead className="w-12 text-right">{/* actions */}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* Newest-first ordering: lowest elapsedTime
                        sits at the top. Matches the convention for
                        live tables — the row most likely to need
                        attention (a fresh join, a hot session) is
                        the row a scanning operator sees first. */}
                    {[...view.clientList]
                      .sort((a, b) => a.elapsedTime - b.elapsedTime)
                      .map((c) => {
                      const pending = pendingKicks.has(c.sessionId);
                      const inState = stateKeys.has(c.sessionId);
                      return (
                      <TableRow
                        key={c.sessionId}
                        data-testid={`client-row-${c.sessionId}`}
                        // Faded + non-interactive while the kick is in
                        // flight. `pointer-events-none` covers the
                        // user-link too so the row reads as "this is
                        // leaving" rather than "still actionable".
                        className={cn(pending && 'opacity-50 pointer-events-none transition-opacity')}
                        aria-busy={pending || undefined}
                      >
                        <TableCell className="font-mono text-xs">
                          {/* Click → searches this sessionId in the
                              state tree. Common operator question:
                              "where does this client appear in state?"
                              becomes a single click instead of a
                              copy-paste-find dance. The magnifier
                              icon fades in on hover/focus as the
                              visual affordance that this is the
                              clickable action (the underline alone
                              read as a normal text-link). */}
                          <button
                            type="button"
                            onClick={() => findInState(c.sessionId)}
                            data-testid={`find-in-state-${c.sessionId}`}
                            title={
                              inState
                                ? `Find ${c.sessionId} in the state tree (referenced)`
                                : `Find ${c.sessionId} in the state tree`
                            }
                            className={cn(
                              'group inline-flex cursor-pointer items-center gap-1 rounded px-0.5',
                              'underline-offset-2 hover:bg-accent hover:underline',
                              'focus:outline-none focus:ring-2 focus:ring-ring',
                            )}
                          >
                            {/* Emerald dot when this sessionId
                                appears as a key anywhere in state.
                                Reserves the layout slot even when
                                absent (invisible variant) so rows
                                stay vertically aligned regardless of
                                which sessions happen to be tracked. */}
                            <span
                              aria-hidden
                              data-testid={inState ? `session-in-state-${c.sessionId}` : undefined}
                              className={cn(
                                'inline-block size-1.5 shrink-0 rounded-full',
                                inState ? 'bg-emerald-500' : 'bg-transparent',
                              )}
                            />
                            <span>{c.sessionId}</span>
                            <Search
                              aria-hidden
                              className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                            />
                          </button>
                        </TableCell>
                        <TableCell>
                          {c.userId
                            ? (
                              <Button asChild variant="link" className="h-auto p-0">
                                <Link to={`/users/show/${c.userId}`}>
                                  <User className="mr-1 size-3" />
                                  {/* Prefer email when the inspector resolved one
                                      — emails are the recognizable handle for a
                                      support workflow. The truncated id sits
                                      next to it as a disambiguator (and a hint
                                      that the row is in fact a user record). */}
                                  {c.userEmail
                                    ? (
                                      <span className="text-xs">
                                        {c.userEmail}
                                        <span className="ml-1 font-mono text-muted-foreground">
                                          ({shortId(c.userId)})
                                        </span>
                                      </span>
                                    )
                                    : <span className="font-mono text-xs">{c.userId}</span>}
                                </Link>
                              </Button>
                            )
                            : (
                              // Matches the authenticated row's
                              // visual structure (icon + label) so
                              // anon and signed-in clients sit on
                              // the same horizontal baseline. The
                              // dimmed icon signals "no identity"
                              // without dropping the column to
                              // bare text.
                              <span className="inline-flex items-center text-xs text-muted-foreground">
                                <User className="mr-1 size-3 opacity-50" />
                                anon
                              </span>
                            )}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap text-right text-muted-foreground tabular-nums"
                          // Absolute join time in the native tooltip
                          // — relative ("10m ago") is great for
                          // glanceability, ISO is what an operator
                          // copies into a log query. Tiny drift (the
                          // poll tick, not render time) is fine for
                          // log correlation.
                          //
                          // "ago" suffix dropped: the column header
                          // already conveys directionality, and the
                          // 3-char savings keeps "6m 34s" from
                          // wrapping in tight column widths.
                          title={new Date(Date.now() - c.elapsedTime).toISOString()}
                        >
                          {formatDuration(c.elapsedTime)}
                        </TableCell>
                        <TableCell className="text-right">
                          {pending ? (
                            // Spinner replaces the kick button while the
                            // request is in flight. Keeps the column
                            // width stable so the row doesn't reflow as
                            // it fades out.
                            <span
                              className="inline-flex size-8 items-center justify-center text-muted-foreground"
                              data-testid={`kick-pending-${c.sessionId}`}
                              aria-label="Kicking"
                            >
                              <Loader2 className="size-4 animate-spin" />
                            </span>
                          ) : (
                            <KickConfirmDialog
                              idKey={c.sessionId}
                              triggerTestId={`kick-${c.sessionId}`}
                              triggerAriaLabel="Kick client"
                              title={<>Kick client {c.sessionId}?</>}
                              description="The client will be disconnected from this room immediately. An optional reason is sent in the close frame and recorded in the audit log."
                              busy={busy}
                              onConfirm={(reason) => kick(c.sessionId, reason)}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Section>

            <Section title="State" testid="section-state" className="mt-0 min-w-0">
              <StateEditor
                roomId={roomId!}
                state={view.state}
                onChanged={refreshNow}
                onEditingChange={setIsEditing}
                searchText={stateSearch}
                onSearchTextChange={setStateSearch}
                searchInputRef={stateSearchInputRef}
              />
            </Section>
          </div>

          {/* Metadata */}
          {view.metadata !== null && (
            <Section title="Metadata" testid="section-metadata">
              <pre className="rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(view.metadata, null, 2)}
              </pre>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * Compact stat tile in the top strip. Defaults to a plain `<div>`; when
 * `onClick` is provided it renders as a `<button>` so the tile *is*
 * the action — used for the Locked-status toggle, which is more
 * discoverable than a separate Lock/Unlock button next to Dispose.
 *
 * `hint` shows on hover (native `title` tooltip) so the click target's
 * effect is discoverable without a UI prompt.
 */
function Stat({
  label, value, hint, onClick, disabled, testid,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  testid?: string;
}) {
  const body = (
    <>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold">{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={hint}
        disabled={disabled}
        onClick={onClick}
        data-testid={testid}
        className={cn(
          'rounded-md border bg-muted/30 px-3 py-2 text-left transition-colors',
          'hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      {body}
    </div>
  );
}

function Section({
  title, testid, className, children,
}: {
  title: React.ReactNode;
  testid?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('mt-6 first:mt-0', className)} data-testid={testid}>
      <h2 className="mb-2 text-sm font-medium tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Collapsible state tree with click-to-edit on leaves and a delete
 * button on object/map/array entries. Mirrors what @colyseus/monitor
 * shipped — leaf edits only (no type changes, no adding keys) so
 * Schema-typed state can't be coerced into an invalid shape from
 * the panel.
 *
 * Mutations go through `/admin-api/rooms/:roomId/state` (PATCH for
 * edits, DELETE for removals); both are audit-logged on the backend.
 * On success we trigger a one-shot refetch so the tree reflects the
 * change without waiting for the next poll tick.
 *
 * Renders `null` / empty state as a muted message instead of an empty
 * tree — feels nicer when a room hasn't installed a state class yet.
 */
/**
 * Dark-mode override for json-edit-react's edit input. The bundled
 * `githubDarkTheme` leaves the input transparent — against our muted
 * panel background, the typed value reads as nearly-invisible dark
 * text on dark. We force a high-contrast color pair (github canvas
 * + foreground) and a thin border so the input is unambiguously a
 * field. Array form `[base, overrides]` is the library's documented
 * way to layer styles on top of a preset.
 */
/**
 * Display-only rounding for floats with more than 3 fractional
 * digits. Lots of Colyseus state ships positions/timings as raw
 * floats (`495.00599215558856`) which is noisy in a scan view.
 *
 * `showOnView: true` + `showOnEdit: false` means the rounded display
 * appears only at rest — clicking the field opens the standard
 * editor with full precision intact, so edits never lose digits.
 */
const NumberPreview: React.FC<{ value: any; nodeData: any; getStyles: any }> = ({
  value, nodeData, getStyles,
}) => {
  if (typeof value !== 'number') { return null; }
  // 2dp matches the precision an operator actually scans for
  // (positions, timings, ratios) without showing 16 digits of
  // floating-point noise. Editing reveals the full precision —
  // see `showOnEdit: false` on the definition below.
  const display = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  return <span style={getStyles('number', nodeData)}>{display}</span>;
};

const numberPreviewDef = {
  condition: ({ value }: { value: unknown }) =>
    typeof value === 'number' && !Number.isInteger(value),
  element: NumberPreview as any,
  showOnView: true,
  showOnEdit: false,
} as const;

const darkInputOverride = {
  input: {
    color: '#e6edf3',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '4px',
    padding: '1px 6px',
  },
  inputHighlight: {
    backgroundColor: '#1f6feb55',
  },
} as const;

function StateEditor({
  roomId, state, onChanged, onEditingChange,
  searchText, onSearchTextChange, searchInputRef,
}: {
  roomId: string;
  state: any;
  onChanged: () => void;
  /** Toggled by json-edit-react's onEditEvent — true while a field
   *  is open for editing, false when it closes (save/cancel/blur).
   *  The parent uses this to pause polling so the input doesn't get
   *  yanked mid-keystroke. */
  onEditingChange: (editing: boolean) => void;
  /** Search query forwarded to JsonEditor (filters both keys and
   *  values). Lifted to the parent so the Clients table can
   *  populate it on sessionId click. */
  searchText: string;
  onSearchTextChange: (value: string) => void;
  /** Ref the parent uses to focus/scroll the search input after a
   *  cross-link click ("find this sessionId in state"). */
  searchInputRef: React.RefObject<HTMLInputElement>;
}) {
  const { resolved: themeMode } = useTheme();

  async function save(path: Array<string | number>, value: unknown): Promise<void> {
    const res = await fetch(`/admin-api/rooms/${roomId}/state`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, value }),
    });
    if (!res.ok) { throw new Error(`save failed (HTTP ${res.status})`); }
    onChanged();
  }

  async function remove(path: Array<string | number>): Promise<void> {
    const res = await fetch(`/admin-api/rooms/${roomId}/state`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) { throw new Error(`delete failed (HTTP ${res.status})`); }
    onChanged();
  }

  if (state === null || state === undefined) {
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        No state attached to this room.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search input — searches both keys and values across the
          tree. The Clients table populates this when a sessionId is
          clicked; clearing the field (X button) drops the filter.
          The wrapping div is the scroll container for the editor
          beneath; the input sits OUTSIDE the scroll so it stays
          pinned while the operator scans results. */}
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchInputRef}
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          placeholder="Search state tree (key or value)…"
          className="h-8 pl-8 pr-8 text-xs"
          data-testid="state-search"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => onSearchTextChange('')}
            aria-label="Clear search"
            data-testid="state-search-clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        )}
      </div>

      {/* max-h + overflow-auto keeps a deep state tree from pushing
          the page-scroll past the Clients column on wide layouts —
          pairs with the sticky Clients section in the parent grid.
          70vh gives most of the viewport while leaving the global
          page header visible. */}
      <div className="rounded-md border bg-muted/40 p-2 text-xs max-h-[70vh] overflow-auto">
      <JsonEditor
        data={state}
        rootName=""
        theme={themeMode === 'dark' ? [githubDarkTheme, darkInputOverride] : githubLightTheme}
        customNodeDefinitions={[numberPreviewDef as any]}
        searchText={searchText}
        // 'all' filters on either key or value matches — most natural
        // when looking up a sessionId that might appear as a key
        // (`players: { sessionId: ... }`) or as a value
        // (`turnOrder: ['abc', 'def']`).
        searchFilter="all"
        // Object/array/map containers shouldn't be replaced wholesale
        // from the panel — Schema-typed state would reject the swap
        // anyway. Returning true here forbids the edit for that node.
        restrictEdit={({ value }) => typeof value === 'object' && value !== null}
        restrictAdd={true}
        restrictTypeSelection={true}
        // `onEditEvent(path, isKey)` fires with a non-null `path`
        // when the user opens an editor and again with `null` when
        // it closes (save / cancel / blur). We pass that boolean
        // up so the parent's poll loop pauses while the field is
        // open — otherwise the 2s tick would stomp the operator's
        // in-progress keystrokes.
        onEditEvent={(path) => onEditingChange(path !== null)}
        // The library calls onUpdate / onDelete with the same shape it
        // would write locally. We forward to the backend; on failure
        // we surface a toast AND return an error string, which causes
        // the editor to revert its optimistic local update.
        onUpdate={async ({ newValue, path }) => {
          try {
            await save(path as Array<string | number>, newValue);
          } catch (err: any) {
            toast.error(err?.message ?? 'state edit failed');
            return 'JSON Edit Error'; // truthy ⇒ library reverts
          }
        }}
        onDelete={async ({ path }) => {
          try {
            await remove(path as Array<string | number>);
          } catch (err: any) {
            toast.error(err?.message ?? 'state delete failed');
            return 'JSON Edit Error';
          }
        }}
      />
      </div>
    </div>
  );
}

/** First 6 chars of a userId — enough to disambiguate side-by-side rows
 *  without dominating the cell. The full id is still on the deep-link
 *  href, and the user's show page is one click away. */
function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 6)}…`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) { return `${ms}ms`; }
  const s = Math.floor(ms / 1000);
  if (s < 60) { return `${s}s`; }
  const m = Math.floor(s / 60);
  if (m < 60) { return `${m}m ${s % 60}s`; }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Mirrors the rooms-list formatter: `null` arrives over the wire for
 *  `Infinity`, and `0` means "no cap" in practice — render both as ∞. */
function formatMaxClients(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) { return '∞'; }
  return value.toLocaleString();
}
