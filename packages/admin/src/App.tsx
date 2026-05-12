import { useEffect, useState } from 'react';
import { Authenticated, Refine } from '@refinedev/core';
import './index.css';
import dataProvider from '@refinedev/simple-rest';
import routerProvider from '@refinedev/react-router';
import { BrowserRouter, Routes, Route, Outlet, NavLink, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Toaster } from 'sonner';
import type { Resource } from './types';
import { ListPage, ShowPage, EditPage, CreatePage } from './pages';
import { RoomsListPage } from './pages/rooms/list';
import { RoomShowPage } from './pages/rooms/show';
import { Dashboard } from './Dashboard';
import { iconFor } from './icons';
import { authProvider } from './authProvider';
import { notificationProvider } from './notification-provider';
import { LoginPage } from './LoginPage';
import { SetupPage } from './SetupPage';
import { SignInGate } from './SignInGate';
import { UserHeader } from './UserHeader';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '@/lib/theme-provider';
import { LayoutDashboard, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

const API = '/admin-api';

// Cookie-based: send the session on every request. The X-User-Id header is
// only forwarded when the impersonation input (gated behind ?dev=1) has a
// value — production puppeteer tests use that, real users don't see it.
const http = axios.create({ withCredentials: true });
http.interceptors.request.use((config) => {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev')) {
    const userId = localStorage.getItem('colyseus-admin-user-id') ?? '';
    if (userId) { config.headers.set('X-User-Id', userId); }
  }
  return config;
});

const provider = dataProvider(API, http);

export function App() {
  const [resources, setResources] = useState<Resource[] | null>(null);

  useEffect(() => {
    fetch(API, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : [])
      .then(setResources)
      .catch(() => setResources([]));
  }, []);

  // Refine binds `resources` once at mount — empty array → empty sidebar even
  // after a later setResources(...). Block render until the catalog is loaded
  // so the menu is correct from the first paint.
  if (resources === null) {
    return (
      <div data-testid="loading" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#71717a' }}>
        loading…
      </div>
    );
  }

  return (
    <ThemeProvider>
    <BrowserRouter basename="/admin">
      <Refine
        dataProvider={provider}
        routerProvider={routerProvider}
        authProvider={authProvider}
        notificationProvider={notificationProvider}
        options={{ syncWithLocation: true, warnWhenUnsavedChanges: false }}
        resources={resources.map((r) => ({
          name: r.name,
          list: `/${r.name}`,
          show: `/${r.name}/show/:id`,
          edit: `/${r.name}/edit/:id`,
          create: `/${r.name}/create`,
          meta: { label: r.label },
        }))}
      >
        <Routes>
          {/* Public routes — login + first-run setup */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />

          {/* Authenticated routes — <Authenticated> guards them via
              authProvider.check(). The fallback is SignInGate which itself
              checks /auth/status to decide between rendering LoginPage and
              redirecting to /setup (first-run). This preserves the
              "no admin yet → bootstrap" UX without storing extra state. */}
          <Route
            element={
              <Authenticated key="protected" fallback={<SignInGate />}>
                <ProtectedShell resources={resources} />
              </Authenticated>
            }
          >
            <Route path="/" element={<Dashboard />} />
            {/* Live rooms inspector — routes declared BEFORE the generic
                `:resource` route so the static `rooms` path wins. Refine
                never owns this surface; the pages talk to /admin-api/rooms
                directly. */}
            <Route path="rooms" element={<RoomsListPage />} />
            <Route path="rooms/:roomId" element={<RoomShowPage />} />
            <Route path=":resource" element={<ListPage resources={resources} />} />
            <Route path=":resource/show/:id" element={<ShowPage resources={resources} />} />
            <Route path=":resource/edit/:id" element={<EditPage resources={resources} />} />
            <Route path=":resource/create" element={<CreatePage resources={resources} />} />
          </Route>
        </Routes>
        <Toaster position="bottom-right" richColors closeButton />
      </Refine>
    </BrowserRouter>
    </ThemeProvider>
  );
}

/**
 * Authenticated shell — sidebar + header + outlet, all shadcn/Tailwind.
 * Replaces refine-antd's ThemedLayoutV2/ThemedSiderV2: those gave us the
 * AntD Menu + Layout primitives for free, but locked us to the AntD theme
 * and pulled in CSS we no longer need.
 */
function ProtectedShell({ resources }: { resources: Resource[] }) {
  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar resources={resources} />
      {/* min-w-0 + min-w-0 on every flex link in the chain — without this the
          column expands to fit a wide table and the entire page grows
          horizontally instead of the table scrolling inside its container. */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center justify-end gap-3 border-b bg-background px-6">
          <ThemeToggle />
          <UserHeader />
        </header>
        <main className="flex-1 p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ resources }: { resources: Resource[] }) {
  const { pathname } = useLocation();
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
      <div className="px-4 py-4 text-base font-semibold tracking-tight">Colyseus</div>
      <nav className="space-y-1 px-2 py-2">
        <SidebarLink to="/" icon={<LayoutDashboard className="size-4" />} active={pathname === '/'}>
          Dashboard
        </SidebarLink>
        <SidebarLink
          to="/rooms"
          icon={<Radio className="size-4" />}
          active={pathname === '/rooms' || pathname.startsWith('/rooms/')}
        >
          Live rooms
        </SidebarLink>
        <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Resources
        </div>
        {resources.map((r) => (
          <SidebarLink
            key={r.name}
            to={`/${r.name}`}
            icon={iconFor(r.icon)}
            active={pathname.startsWith(`/${r.name}`)}
          >
            {r.label}
          </SidebarLink>
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({ to, icon, active, children }: {
  to: string;
  icon: React.ReactElement;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {icon}
      <span>{children}</span>
    </NavLink>
  );
}
