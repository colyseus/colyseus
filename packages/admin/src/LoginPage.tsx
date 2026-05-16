/**
 * Bare-bones login screen. Email + password → POST /admin-api/auth/login.
 * On first run (no admins exist), Refine's authProvider.check() routes the
 * unauthenticated user to /setup instead — see SetupPage.tsx.
 *
 * Honors a `?next=<path>` query param so the admin.guard() middleware on
 * /monitor and /playground can round-trip the user back to where they
 * started. The next value is sanity-checked for same-origin (must be a
 * plain path) before we navigate to it, so a tampered link can't bounce
 * to an external host.
 */
import { useState } from 'react';
import { useLogin } from '@refinedev/core';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { consumeNextParam } from '@/lib/next-param';

export function LoginPage() {
  const { mutate: login, isLoading } = useLogin<{ email: string; password: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login(
      { email, password },
      {
        onSuccess: (data) => {
          if (data?.success === false) {
            setError(data.error?.message ?? 'Sign in failed');
            return;
          }
          // Always hard-nav, never a Refine SPA redirect. Two reasons:
          //  - `?next=` (from the guard middleware on /monitor,
          //    /playground) points outside the admin SPA's router.
          //  - the catalog (`GET /admin-api`) is now operator-gated, so
          //    App's mount-time fetch ran while anonymous and returned
          //    []. A full reload remounts App and refetches it with the
          //    session cookie, so the sidebar is populated.
          // NOTE: the shipped bundle is built once at publish time, so the
          // mount root is fixed at '/admin/'. Customizing admin()'s uiPath
          // is a backend-only knob today — the prebuilt UI does not support
          // it (see vite base + App.tsx basename). Keep this literal in
          // sync with those if that limitation is ever lifted.
          const next = consumeNextParam();
          window.location.replace(next || '/admin/');
        },
      },
    );
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <Card className="w-[380px]" data-testid="login-card">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Colyseus Admin</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="login-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
              data-testid="login-submit"
            >
              {isLoading && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
