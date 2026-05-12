/**
 * Room inspector — drilling into a single live room. Polls
 * `GET /admin-api/rooms/:roomId` and renders:
 *
 *   - top stat strip (clients, locked, elapsed, stateSize)
 *   - state JSON (read-only — state edit is deferred to a later phase)
 *   - clients table with per-row Kick (audited)
 *   - dispose-room action (audited)
 *
 * Mutation flows show a confirm dialog before firing — both kick and
 * dispose are irreversible. Failures surface as a toast.
 */
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, X, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Page } from '@/components/ui/page';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 2000;

interface InspectorView {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
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

    void fetchOnce();
    timer = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) { window.clearInterval(timer); } };
  }, [roomId]);

  async function kick(sessionId: string) {
    if (!roomId) { return; }
    setBusy(true);
    try {
      const res = await fetch(
        `/admin-api/rooms/${roomId}/clients/${sessionId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) { throw new Error(`kick failed (HTTP ${res.status})`); }
      toast.success(`Kicked ${sessionId}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'kick failed');
    } finally {
      setBusy(false);
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
            <Stat label="Clients" value={`${view.clients}${view.maxClients ? ` / ${view.maxClients}` : ''}`} />
            <Stat label="Status" value={view.locked ? 'locked' : 'open'} />
            <Stat label="Uptime" value={formatDuration(view.elapsedTime)} />
            <Stat label="State size" value={`${view.stateSize} B`} />
          </div>

          {/* Clients */}
          <Section title="Clients" testid="section-clients">
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
                  {view.clientList.map((c) => (
                    <TableRow key={c.sessionId} data-testid={`client-row-${c.sessionId}`}>
                      <TableCell className="font-mono text-xs">{c.sessionId}</TableCell>
                      <TableCell>
                        {c.userId
                          ? (
                            <Button asChild variant="link" className="h-auto p-0">
                              <a href={`/admin/users/show/${c.userId}`}>
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
                              </a>
                            </Button>
                          )
                          : <span className="text-xs text-muted-foreground">anon</span>}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatDuration(c.elapsedTime)} ago
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost" size="icon"
                              disabled={busy}
                              data-testid={`kick-${c.sessionId}`}
                              aria-label="Kick client"
                            >
                              <X className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Kick client {c.sessionId}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The client will be disconnected from this room immediately.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => kick(c.sessionId)}
                                data-testid={`kick-confirm-${c.sessionId}`}
                              >
                                Kick
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>

          {/* State */}
          <Section title="State" testid="section-state">
            <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {JSON.stringify(view.state, null, 2)}
            </pre>
          </Section>

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

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}

function Section({
  title, testid, children,
}: { title: string; testid?: string; children: React.ReactNode }) {
  return (
    <section className={cn('mt-6 first:mt-0')} data-testid={testid}>
      <h2 className="mb-2 text-sm font-medium tracking-tight">{title}</h2>
      {children}
    </section>
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
