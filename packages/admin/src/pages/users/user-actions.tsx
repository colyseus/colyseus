/**
 * Header-action buttons for the user show page — Ban / Unban / Revoke
 * sessions. Each posts to a dedicated `/admin-api/users/:userId/*`
 * endpoint and surfaces success/failure via sonner.
 *
 * Why dedicated UI instead of routing through the generic
 * resource-actions framework: the Ban flow needs a form (reason +
 * optional until date), and the framework's per-row action API
 * only accepts a row id. Keeping the UI bespoke also lets us tie
 * the visible label to live state — the Ban button flips to Unban
 * when bannedUntil is in the future.
 *
 * The component receives the freshly-fetched user record so the
 * Ban/Unban label reflects current state without a separate poll.
 */
import * as React from 'react';
import { Ban, ShieldOff, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface UserActionsProps {
  userId: string;
  /** Pass the latest user record so the button labels (Ban vs Unban)
   *  reflect current ban state. Optional — when missing we render
   *  the Ban variant. */
  user?: Record<string, any>;
  /** Called after a successful action so the show page can refetch
   *  and update the displayed columns immediately. */
  onChanged?: () => void;
}

/**
 * Compare a possibly-null bannedUntil against now. PG dates arrive as
 * ISO strings; sqlite as ms-since-epoch numbers. `new Date(...)`
 * accepts both. A ban is "active" when its until is in the future
 * (the service stores a year-9999 sentinel for permanent bans).
 */
function isBanned(value: unknown): boolean {
  if (value == null) { return false; }
  const t = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
  return Number.isFinite(t) && t > Date.now();
}

export function UserActions({ userId, user, onChanged }: UserActionsProps) {
  // The CRUD list/get endpoint returns rows with SQL-cased keys
  // (`banned_until`), but `findByEmail` and other JS code paths
  // produce camelCase (`bannedUntil`). Accept either so the toggle
  // works regardless of how the record was fetched.
  const bannedUntil = user?.banned_until ?? user?.bannedUntil;
  const banned = isBanned(bannedUntil);
  const [busy, setBusy] = React.useState<null | 'ban' | 'unban' | 'revoke'>(null);
  const [banReason, setBanReason] = React.useState('');
  const [banDuration, setBanDuration] = React.useState<'1d' | '7d' | '30d' | 'permanent'>('permanent');
  const [banOpen, setBanOpen] = React.useState(false);

  async function call(
    path: string,
    body: unknown,
    label: 'ban' | 'unban' | 'revoke',
    successMsg: string,
  ): Promise<void> {
    setBusy(label);
    try {
      const res = await fetch(`/admin-api/users/${encodeURIComponent(userId)}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
      }
      toast.success(successMsg);
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message ?? `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  /** Turn the preset into an ISO string for the API; `permanent`
   *  sends `null` so the backend uses its year-9999 sentinel. */
  function untilFromPreset(): string | null {
    if (banDuration === 'permanent') { return null; }
    const days = banDuration === '1d' ? 1 : banDuration === '7d' ? 7 : 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  return (
    <div className="flex items-center gap-2">
      {banned ? (
        // Unban is restorative — outline keeps it visually neutral so
        // it doesn't read as another destructive action.
        <Button
          variant="outline" size="sm"
          disabled={busy !== null}
          data-testid="unban-user"
          onClick={() =>
            void call('unban', {}, 'unban', 'User unbanned')
          }
        >
          {busy === 'unban'
            ? <><Loader2 className="mr-1 size-4 animate-spin" /> Unbanning…</>
            : <><ShieldOff className="mr-1 size-4" /> Unban</>}
        </Button>
      ) : (
        <AlertDialog open={banOpen} onOpenChange={setBanOpen}>
          <AlertDialogTrigger asChild>
            {/* Destructive — locks the user out of sign-in until Unban.
                The confirm dialog gates accidental clicks. */}
            <Button
              variant="destructive" size="sm"
              disabled={busy !== null}
              data-testid="ban-user"
            >
              {busy === 'ban'
                ? <><Loader2 className="mr-1 size-4 animate-spin" /> Banning…</>
                : <><Ban className="mr-1 size-4" /> Ban</>}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Ban this user?</AlertDialogTitle>
              <AlertDialogDescription>
                The user's next sign-in attempt will be rejected and
                their active sessions are revoked immediately. The
                action is reversible via Unban.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ban-duration">Duration</Label>
                <div
                  role="group"
                  aria-label="Ban duration"
                  className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs"
                >
                  {(['1d', '7d', '30d', 'permanent'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={banDuration === p}
                      onClick={() => setBanDuration(p)}
                      data-testid={`ban-duration-${p}`}
                      className={
                        'rounded px-2 py-1 transition-colors ' +
                        (banDuration === p
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground')
                      }
                    >
                      {p === 'permanent' ? 'Permanent' : p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ban-reason">Reason (optional)</Label>
                <Input
                  id="ban-reason"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Policy citation, ticket id, …"
                  maxLength={500}
                  data-testid="ban-reason"
                />
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy !== null}
                data-testid="ban-confirm"
                onClick={() => {
                  void call(
                    'ban',
                    { reason: banReason.trim() || undefined, until: untilFromPreset() },
                    'ban',
                    'User banned',
                  ).then(() => {
                    setBanOpen(false);
                    setBanReason('');
                  });
                }}
              >
                Ban
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          {/* Destructive — every JWT issued before this moment is
              invalidated; the user has to sign in again on every
              device. The confirm dialog has its own copy of why. */}
          <Button
            variant="destructive" size="sm"
            disabled={busy !== null}
            data-testid="revoke-sessions"
            title="Bump the user's token version — every issued JWT becomes invalid on its next request"
          >
            {busy === 'revoke'
              ? <><Loader2 className="mr-1 size-4 animate-spin" /> Revoking…</>
              : <><LogOut className="mr-1 size-4" /> Revoke sessions</>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign this user out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Bumps the user's token version. Every JWT issued before
              this moment becomes invalid on its next request — the
              user has to sign in again on every device. Use after a
              suspected account compromise or a password change you
              made on their behalf.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              data-testid="revoke-sessions-confirm"
              onClick={() =>
                void call('revoke-sessions', {}, 'revoke', 'Sessions revoked')
              }
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
