/**
 * Authenticated-fallback for unauthenticated visitors.
 *
 * Refine's <CatchAllNavigate> always points at one URL, which loses the
 * first-run distinction between "log in" vs "bootstrap an admin". This
 * component reads /admin-api/auth/status once on mount and decides where
 * to send the visitor.
 *
 * It always *redirects* (never renders the form in place): an anonymous
 * hit on a deep protected route like /admin/rooms or /admin/users/42
 * lands on the canonical /admin/login (or /admin/setup on first run)
 * instead of leaving the protected URL in the address bar with the
 * login form painted over it. `/login` and `/setup` are public routes
 * (outside <Authenticated>), so this can't loop.
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

interface Status {
  needsBootstrap: boolean;
  authenticated: boolean;
}

export function SignInGate() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/admin-api/auth/status', { credentials: 'include' })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ needsBootstrap: false, authenticated: false }));
  }, []);

  if (!status) { return null; }
  if (status.needsBootstrap) {
    return <Navigate to="/setup" replace />;
  }
  return <Navigate to="/login" replace />;
}
