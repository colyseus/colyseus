/**
 * "Active sessions" tab on the user show page — answers the support
 * question "which rooms is this user currently connected to?" without
 * crawling the full room list. Backed by `/admin-api/rooms/by-user/:userId`,
 * which reads the Presence reverse index that Rooms maintain at join /
 * leave time.
 *
 * Polls on a 3s cadence (loose match to the room-show page's 2s) so
 * the count stays fresh without hammering the server.
 */
import * as React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, DoorOpen } from 'lucide-react';
import { toast } from 'sonner';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { KickConfirmDialog } from '../internals/kick-confirm-dialog';
import { withReturnTo } from '../internals/return-to';

const POLL_INTERVAL_MS = 3000;

export interface ActiveUserSession {
  roomId: string;
  roomName: string;
  sessionId: string;
  joinedAt: number;
  processId?: string | null;
}

export function ActiveUserSessionsTab({
  userId,
  onCountChange,
}: {
  userId: string;
  /** Fires every time the polled list changes length. The show page
   *  uses it to override the stale `_counts.__active_sessions` badge
   *  (which is captured once at page-open) so the tab strip reflects
   *  reality after a session joins/leaves while the tab is visible. */
  onCountChange?: (count: number) => void;
}) {
  const [sessions, setSessions] = React.useState<ActiveUserSession[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Hold the callback in a ref so changing it between renders doesn't
  // re-trigger `fetchOnce` (which would restart the polling loop).
  const onCountChangeRef = React.useRef(onCountChange);
  React.useEffect(() => { onCountChangeRef.current = onCountChange; }, [onCountChange]);

  const fetchOnce = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/admin-api/rooms/by-user/${encodeURIComponent(userId)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ActiveUserSession[];
      setSessions(data);
      setError(null);
      onCountChangeRef.current?.(data.length);
    } catch (err: any) {
      setError(err?.message ?? 'failed to load');
    }
  }, [userId]);

  React.useEffect(() => {
    let cancelled = false;
    void fetchOnce();
    const timer = window.setInterval(() => {
      if (!cancelled) { void fetchOnce(); }
    }, POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [fetchOnce]);

  async function kick(roomId: string, sessionId: string, reason?: string) {
    setBusy(true);
    try {
      const trimmed = reason?.trim();
      const res = await fetch(
        `/admin-api/rooms/${encodeURIComponent(roomId)}/clients/${encodeURIComponent(sessionId)}`,
        {
          method: 'DELETE', credentials: 'include',
          ...(trimmed ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: trimmed }),
          } : {}),
        },
      );
      if (!res.ok) { throw new Error(`kick failed (HTTP ${res.status})`); }
      toast.success(`Kicked ${sessionId}`);
      // Refresh immediately so the row disappears without waiting for poll.
      void fetchOnce();
    } catch (err: any) {
      toast.error(err?.message ?? 'kick failed');
    } finally {
      setBusy(false);
    }
  }

  if (sessions === null && !error) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-sm">loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>This user has no active sessions right now.</p>
        <p className="text-xs">
          Not seeing sessions you expect? The{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            TrackUserSessionsPlugin
          </code>{' '}
          must be installed on the Room types you want to surface here.{' '}
          <a
            href="https://docs.colyseus.io/room/plugins/track-user-sessions"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Docs →
          </a>
        </p>
      </div>
    );
  }

  return (
    <Table data-testid="active-sessions-table">
      <TableHeader>
        <TableRow>
          <TableHead>Room</TableHead>
          <TableHead>Session</TableHead>
          <TableHead className="text-right">Joined</TableHead>
          <TableHead className="w-12 text-right">{/* actions */}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => (
          <TableRow key={`${s.roomId}:${s.sessionId}`} data-testid={`active-session-${s.sessionId}`}>
            <TableCell>
              <Button asChild variant="link" className="h-auto p-0">
                {/* returnTo points back at the user's show page so the
                    room inspector's back-arrow and post-dispose redirect
                    land on the Active sessions tab (split-layout default)
                    instead of the global /rooms list. */}
                <Link to={withReturnTo(`/rooms/${s.roomId}`, `/users/show/${userId}`)}>
                  <DoorOpen className="mr-1 size-3" />
                  <span className="text-xs">
                    {s.roomName}
                    <span className="ml-1 font-mono text-muted-foreground">({shortId(s.roomId)})</span>
                  </span>
                </Link>
              </Button>
            </TableCell>
            <TableCell className="font-mono text-xs">{s.sessionId}</TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              {formatAgo(Date.now() - s.joinedAt)}
            </TableCell>
            <TableCell className="text-right">
              <KickConfirmDialog
                idKey={s.sessionId}
                triggerTestId={`active-session-kick-${s.sessionId}`}
                triggerAriaLabel="Kick session"
                title={<>Kick session from {s.roomName}?</>}
                description={<>Session <span className="font-mono">{s.sessionId}</span> will be disconnected from the room immediately. An optional reason is sent in the close frame and recorded in the audit log.</>}
                busy={busy}
                onConfirm={(reason) => kick(s.roomId, s.sessionId, reason)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}

function formatAgo(ms: number): string {
  if (ms < 1000) { return 'just now'; }
  const s = Math.floor(ms / 1000);
  if (s < 60) { return `${s}s ago`; }
  const m = Math.floor(s / 60);
  if (m < 60) { return `${m}m ago`; }
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
