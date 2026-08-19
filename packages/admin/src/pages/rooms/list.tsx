/**
 * Live rooms list. Polls `GET /admin-api/rooms` every few seconds and
 * renders the result as a sortable table. Bypasses Refine's `useTable`
 * — rooms aren't a database CRUD resource (no PK, no filters, no
 * pagination), so a plain React component is simpler than coercing
 * refine.
 *
 * Filter + paginate happen client-side: the polled list is small and
 * the operator's UX benefits from instant feedback (no extra round
 * trip per keystroke). The polled data refresh leaves the operator's
 * filter/page state untouched.
 *
 * Phase 3 will swap the poll for a Presence-driven WebSocket; the
 * fetch surface is small enough that the migration is straightforward.
 */
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Lock, Unlock, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SearchInput } from '../internals/search';
import { Pagination } from '../internals/pagination';
import { API } from '@/lib/runtime-config';

const POLL_INTERVAL_MS = 3000;
const PAGE_SIZE = 20;

type LockFilter = 'all' | 'locked' | 'unlocked';

interface RoomSummary {
  roomId: string;
  name: string;
  clients: number;
  /** `null` when the room has no cap (Room.maxClients = Infinity — JSON
   *  serializes Infinity to `null`). */
  maxClients: number | null;
  locked: boolean;
  private: boolean;
  createdAt: string;
  elapsedTime: number;
  processId?: string | null;
  publicAddress?: string | null;
}

export function RoomsListPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = React.useState<RoomSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [lockFilter, setLockFilter] = React.useState<LockFilter>('all');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const fetchOnce = async () => {
      try {
        const res = await fetch(`${API}/rooms`, { credentials: 'include' });
        if (!res.ok) {
          setError(res.status === 403 ? 'You do not have permission to view rooms.' : `HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setRooms(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) { setError(err?.message ?? 'failed to load rooms'); }
      }
    };

    void fetchOnce();
    timer = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) { window.clearInterval(timer); } };
  }, []);

  // Filter + paginate over the freshest poll result. Memoize so the
  // poll's identity-equal updates don't churn downstream renders.
  const filtered = React.useMemo(() => {
    if (!rooms) { return []; }
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (lockFilter === 'locked' && !r.locked) { return false; }
      if (lockFilter === 'unlocked' && r.locked) { return false; }
      if (q.length === 0) { return true; }
      return (
        r.roomId.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.processId?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rooms, query, lockFilter]);

  // Clamp page when the filter shrinks the list past the current page.
  // Done as an effect so the table renders on the clamped page next tick.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  React.useEffect(() => {
    if (page > totalPages) { setPage(totalPages); }
  }, [page, totalPages]);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRooms = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  if (rooms === null && !error) {
    return (
      <Page title="Live rooms">
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="ml-2 text-sm">loading…</span>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title="Live rooms"
      actions={
        <div className="flex items-center gap-2">
          <SearchInput
            resourceName="rooms"
            currentValue={query}
            onApply={(v) => { setQuery(v); setPage(1); }}
          />
          <LockFilterToggle
            value={lockFilter}
            onChange={(v) => { setLockFilter(v); setPage(1); }}
          />
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {rooms && rooms.length === 0 && (
        <Empty title="No active rooms">
          <p className="text-xs text-muted-foreground">When players connect, rooms will appear here.</p>
        </Empty>
      )}
      {rooms && rooms.length > 0 && filtered.length === 0 && (
        <Empty title="No rooms match your filter">
          <p className="text-xs text-muted-foreground">Adjust the search or lock filter to see more rooms.</p>
        </Empty>
      )}
      {pageRooms.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Room ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Clients</TableHead>
              <TableHead className="text-right">Max clients</TableHead>
              <TableHead>Locked status</TableHead>
              <TableHead className="text-right">Uptime</TableHead>
              <TableHead>Process</TableHead>
              <TableHead className="w-12 text-right">{/* actions */}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRooms.map((r) => (
              <TableRow
                key={r.roomId}
                data-testid={`room-row-${r.roomId}`}
                onClick={() => navigate(`/rooms/${r.roomId}`)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <TableCell className="font-mono text-xs">{r.roomId}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.clients}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatMaxClients(r.maxClients)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant={r.locked ? 'secondary' : 'outline'}>
                      {r.locked
                        ? <Lock className="mr-1 size-3" />
                        : <Unlock className="mr-1 size-3" />}
                      {r.locked ? 'locked' : 'unlocked'}
                    </Badge>
                    {/* `private` is an orthogonal flag (room hidden from
                        the matchmaker's public lobby query) — kept in
                        this cell as a secondary badge so the table
                        stays compact instead of growing another column. */}
                    {r.private && <Badge variant="outline">private</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatDuration(r.elapsedTime)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.processId ?? '—'}
                </TableCell>
                <TableCell
                  className="text-right"
                  // Stop click from bubbling to the row handler — the
                  // inner `<Link>` already navigates to the same place,
                  // and dual-firing would queue two history entries.
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button asChild variant="ghost" size="icon" data-testid={`room-inspect-${r.roomId}`}>
                    <Link to={`/rooms/${r.roomId}`} aria-label="Inspect"><Eye className="size-4" /></Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {filtered.length > PAGE_SIZE && (
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onChange={setPage}
        />
      )}
    </Page>
  );
}

/** Compact uptime — picks the largest unit that's at least 1 of. */
function formatDuration(ms: number): string {
  if (ms < 1000) { return `${ms}ms`; }
  const s = Math.floor(ms / 1000);
  if (s < 60) { return `${s}s`; }
  const m = Math.floor(s / 60);
  if (m < 60) { return `${m}m ${s % 60}s`; }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** `null` arrives over the wire for `Infinity` (JSON.stringify quirk).
 *  `0` is technically also "no cap reached" but Room treats it the same
 *  as Infinity in practice — render it as unlimited too. */
function formatMaxClients(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) { return '∞'; }
  return value.toLocaleString();
}

function LockFilterToggle({
  value, onChange,
}: { value: LockFilter; onChange: (v: LockFilter) => void }) {
  const options: Array<{ value: LockFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'locked', label: 'Locked' },
    { value: 'unlocked', label: 'Unlocked' },
  ];
  return (
    <div
      role="group"
      aria-label="Lock filter"
      data-testid="rooms-lock-filter"
      className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-testid={`rooms-lock-filter-${o.value}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={
            'rounded px-2 py-1 transition-colors ' +
            (value === o.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
