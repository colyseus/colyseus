/**
 * Header strip showing the signed-in identity + logout button.
 *
 * Replaces the previous dev-only "acting as user-id" input. That input
 * is still available behind ?dev=1 (e.g. for puppeteer tests that want
 * to swap roles fast without going through login).
 */
import { useGetIdentity, useLogout } from '@refinedev/core';
import { LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface Identity {
  userId: string;
  role: 'admin' | 'mod' | 'user';
}

export function UserHeader() {
  const { data: identity } = useGetIdentity<Identity>();
  const { mutate: logout } = useLogout();

  // ?dev=1 unlocks the impersonation input — used by puppeteer + curl-style flows
  const isDev = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('dev');

  if (!identity) { return null; }

  const variant: 'success' | 'info' | 'secondary' =
    identity.role === 'admin' ? 'success' :
    identity.role === 'mod' ? 'info' : 'secondary';

  return (
    <div className="flex items-center gap-3">
      {isDev && <DevImpersonateInput />}
      <Badge variant={variant}>{identity.role}</Badge>
      <span className="text-xs text-muted-foreground font-mono">{identity.userId}</span>
      <Button size="sm" variant="outline" onClick={() => logout()} data-testid="logout-button">
        <LogOut />
        Sign out
      </Button>
    </div>
  );
}

function DevImpersonateInput() {
  const [v, setV] = useState<string>(() => localStorage.getItem('colyseus-admin-user-id') ?? '');
  useEffect(() => { localStorage.setItem('colyseus-admin-user-id', v); }, [v]);
  return (
    <Input
      className="w-80 font-mono text-xs h-8"
      value={v}
      onChange={(e) => setV(e.target.value)}
      data-testid="user-id-input"
      placeholder="dev: X-User-Id override"
    />
  );
}
