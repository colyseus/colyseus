/**
 * Refine auth provider wired to /admin-api/auth/*.
 *
 * Cookie-based: the server sets an HttpOnly JWT on /auth/login + /auth/bootstrap;
 * subsequent requests carry it automatically. Nothing is stored in localStorage
 * (XSS-resistant — can't grab the session via document.cookie).
 */
import type { AuthProvider } from '@refinedev/core';

const API = '/admin-api';

interface AuthStatus {
  needsBootstrap: boolean;
  authenticated: boolean;
  userId: string | null;
  role: 'admin' | 'mod' | 'user' | null;
}

async function fetchStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API}/auth/status`, { credentials: 'include' });
  if (!res.ok) {
    return { needsBootstrap: false, authenticated: false, userId: null, role: null };
  }
  return res.json();
}

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      return { success: true, redirectTo: '/' };
    }
    const body = await res.json().catch(() => ({}));
    return {
      success: false,
      error: {
        name: 'Sign in failed',
        message: (body as any).error || 'Invalid credentials',
      },
    };
  },

  logout: async () => {
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
    return { success: true, redirectTo: '/login' };
  },

  check: async () => {
    const status = await fetchStatus();
    if (status.authenticated) {
      return { authenticated: true };
    }
    // First-run: no admin exists → take the user to /setup instead of /login
    return {
      authenticated: false,
      redirectTo: status.needsBootstrap ? '/setup' : '/login',
      logout: false,
    };
  },

  getIdentity: async () => {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
    if (!res.ok) { return null; }
    return res.json();
  },

  getPermissions: async () => {
    const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
    if (!res.ok) { return null; }
    const me = await res.json();
    return me.role;
  },

  onError: async (error) => {
    const status = error?.statusCode ?? error?.response?.status;
    if (status === 401) {
      // Session expired or never existed — bounce to login
      return { logout: true, redirectTo: '/login' };
    }
    if (status === 403) {
      // The backend tags stale-cookie 403s with `role_mismatch:` so we
      // can distinguish them from "you actually lack permission". The
      // server already cleared the cookie on its response; mirror that
      // by logging out refine state and bouncing to /login.
      const message =
        (error as any)?.message ??
        (error as any)?.response?.data?.error ??
        '';
      if (typeof message === 'string' && message.startsWith('role_mismatch:')) {
        return { logout: true, redirectTo: '/login' };
      }
    }
    return {};
  },
};
