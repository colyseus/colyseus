/**
 * Authenticated-fallback for unauthenticated visitors.
 *
 * Refine's <CatchAllNavigate> always points at one URL, which loses the
 * first-run distinction between "log in" vs "bootstrap an admin". This
 * component reads /admin-api/auth/status once on mount and renders the
 * right thing.
 */
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LoginPage } from './LoginPage';

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
  return <LoginPage />;
}
