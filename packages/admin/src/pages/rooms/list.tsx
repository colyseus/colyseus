/**
 * Live rooms list. Polls `GET /admin-api/rooms` every few seconds and
 * renders the result as a sortable table. Bypasses Refine's `useTable`
 * — rooms aren't a database CRUD resource (no PK, no filters, no
 * pagination), so a plain React component is simpler than coercing
 * refine.
 *
 * Phase 3 will swap the poll for a Presence-driven WebSocket; the
 * fetch surface is small enough that the migration is straightforward.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Lock, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Empty } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const POLL_INTERVAL_MS = 3000;

interface RoomSummary {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  private: boolean;
  createdAt: string;
  elapsedTime: number;
  processId?: string | null;
  publicAddress?: string | null;
}

export function RoomsListPage() {
  const [rooms, setRooms] = React.useState<RoomSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const fetchOnce = async () => {
      try {
        const res = await fetch('/admin-api/rooms', { credentials: 'include' });
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
    <Page title="Live rooms">
      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {rooms && rooms.length === 0 && (
        <Empty title="No active rooms" description="When players connect, rooms will appear here." />
      )}
      {rooms && rooms.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Room ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Clients</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Uptime</TableHead>
              <TableHead>Process</TableHead>
              <TableHead className="w-12 text-right">{/* actions */}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((r) => (
              <TableRow key={r.roomId} data-testid={`room-row-${r.roomId}`}>
                <TableCell className="font-mono text-xs">{r.roomId}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right">
                  {r.clients}
                  {r.maxClients ? <span className="text-muted-foreground"> / {r.maxClients}</span> : null}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {r.locked && <Badge variant="secondary"><Lock className="mr-1 size-3" />locked</Badge>}
                    {r.private && <Badge variant="outline">private</Badge>}
                    {!r.locked && !r.private && <span className="text-xs text-muted-foreground">open</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatDuration(r.elapsedTime)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.processId ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon" data-testid={`room-inspect-${r.roomId}`}>
                    <Link to={`/rooms/${r.roomId}`} aria-label="Inspect"><Eye className="size-4" /></Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
