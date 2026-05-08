/**
 * First-run admin setup. Mounted at /admin/setup; Refine's authProvider.check()
 * sends unauthenticated users here when GET /auth/status reports
 * needsBootstrap: true. On success, the response sets the session cookie and
 * we redirect to /.
 *
 * Once the first admin exists, POST /auth/bootstrap returns 403 — so this
 * page is effectively single-use.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function SetupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/admin-api/auth/bootstrap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) { navigate('/', { replace: true }); return; }
      const body = await res.json().catch(() => ({}));
      setError(body.error || `Setup failed (${res.status})`);
    } catch (err: any) {
      setError(err?.message ?? 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <Card className="w-[420px]" data-testid="setup-card">
        <CardHeader>
          <CardTitle>Welcome — create the first admin</CardTitle>
          <CardDescription>
            This panel doesn't have any administrator yet. The account you create here will own the database.
          </CardDescription>
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
              <Label htmlFor="setup-email">Admin email</Label>
              <Input
                id="setup-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="setup-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="setup-password">Password</Label>
              <Input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="setup-password"
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters. There's no recovery flow yet.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={busy} data-testid="setup-submit">
              {busy && <Loader2 className="animate-spin" />}
              Create admin
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
