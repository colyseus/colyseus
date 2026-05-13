import { useEffect, useState } from 'react';
import { Authenticated, Refine } from '@refinedev/core';
import './index.css';
import dataProvider from '@refinedev/simple-rest';
import routerProvider from '@refinedev/react-router';
import { BrowserRouter, Routes, Route, Outlet, NavLink, useLocation, useParams } from 'react-router-dom';
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
import { LayoutDashboard, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        options={{ syncWithLocation: true, warnWhenUnsavedChanges: false, disableTelemetry: true }}
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
            {/* `<KeyedRoute>` forces a fresh ListPage instance per
                `:resource` so React Query's "keep previous data"
                behavior (which is the right call inside a single
                resource — pagination shouldn't blink) can't leak
                rows from the previously-viewed resource while the
                new one's fetch is in flight. Same pattern guards
                Show/Edit against `:id` race conditions. */}
            <Route path=":resource" element={<KeyedListPage resources={resources} />} />
            <Route path=":resource/show/:id" element={<KeyedShowPage resources={resources} />} />
            {/* Tab-pinned variant: `/users/show/:id/cloudSaves` keeps the
                cloudSaves tab active without drilling into a child row.
                Used by the "Back to Cloud Saves" link inside a nested
                child panel, and by Edit-page returns. */}
            <Route path=":resource/show/:id/:relation" element={<KeyedShowPage resources={resources} />} />
            {/* Drill-in: `/users/show/:id/cloudSaves/:childId` renders the
                child's read-only profile INSIDE the cloudSaves tab. */}
            <Route path=":resource/show/:id/:relation/:childId" element={<KeyedShowPage resources={resources} />} />
            <Route path=":resource/edit/:id" element={<KeyedEditPage resources={resources} />} />
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
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  // Auto-close the drawer on navigation so picking a destination
  // dismisses it instead of stranding the overlay over the new page.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  // Escape closes the drawer — the backdrop covers click-outside.
  useEffect(() => {
    if (!navOpen) { return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setNavOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar resources={resources} />
      {/* Mobile drawer — same nav content, slides in from the left.
          `md:hidden` so the desktop aside is the only nav above the
          breakpoint and we don't double-mount. */}
      <MobileNav
        open={navOpen}
        onClose={() => setNavOpen(false)}
        resources={resources}
      />
      {/* min-w-0 propagates so a wide table scrolls inside the main
          column instead of pushing the whole page horizontally. */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-14 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <Button
            variant="ghost" size="icon" className="md:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
            data-testid="open-nav"
          >
            <Menu className="size-5" />
          </Button>
          {/* Brand visible in the header on mobile (the sidebar header
              that normally shows it is hidden). Hidden on desktop where
              the sidebar already brands the chrome. */}
          <div className="text-base font-semibold tracking-tight md:hidden">Colyseus</div>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <UserHeader />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 min-w-0">
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
      <SidebarNav resources={resources} pathname={pathname} />
    </aside>
  );
}

/**
 * Slide-in nav drawer for mobile. Plain CSS (transform + transition)
 * keeps us off the @radix-ui/react-dialog dependency — the drawer is
 * conceptually a dialog but the surface area we need is tiny and the
 * backdrop / Esc / nav-on-route-change handling lives at the parent.
 */
function MobileNav({
  open, onClose, resources,
}: {
  open: boolean;
  onClose: () => void;
  resources: Resource[];
}) {
  const { pathname } = useLocation();
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 md:hidden',
        // pointer-events-none when closed so the underlying page is
        // interactive even during the backdrop's fade-out frame.
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      {/* Backdrop — clickable to close. */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 flex w-64 flex-col bg-background shadow-xl',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        role="dialog"
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-base font-semibold tracking-tight">Colyseus</span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation">
            <X className="size-4" />
          </Button>
        </div>
        <SidebarNav resources={resources} pathname={pathname} />
      </aside>
    </div>
  );
}

/**
 * The nav list shared between the desktop sidebar and the mobile
 * drawer. Same routes, same active-link styling — single source of
 * truth so adding a new top-level link is one edit.
 */
function SidebarNav({ resources, pathname }: { resources: Resource[]; pathname: string }) {
  return (
    <nav className="space-y-1 px-2 py-2">
      <SidebarLink to="/" icon={<LayoutDashboard className="size-4" />} active={pathname === '/'}>
        Dashboard
      </SidebarLink>
      <SidebarLink
        to="/rooms"
        icon={iconFor('radio')}
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

/**
 * Remount the page when route params change so refine's "keep previous
 * data" (react-query default) can't leak rows from a different
 * `:resource` / `:id`. React Router reuses the same instance across
 * param changes by default — the `key` prop is what forces a fresh
 * mount and clears the stale `tableQuery.data` / `useOne` data.
 *
 * Three tiny wrappers (not one generic shim) so each page reads the
 * URL params it actually cares about — keying on a too-coarse value
 * (e.g. `pathname`) would over-remount on incidental URL changes like
 * search params.
 */
function KeyedListPage({ resources }: { resources: Resource[] }) {
  const { resource } = useParams();
  return <ListPage key={resource ?? ''} resources={resources} />;
}

function KeyedShowPage({ resources }: { resources: Resource[] }) {
  // Key on (resource, id) only — switching tabs or drilling into a
  // child relation changes `:relation` / `:childId` but we don't
  // want to remount the parent useOne fetch in that case.
  const { resource, id } = useParams();
  return <ShowPage key={`${resource}:${id ?? ''}`} resources={resources} />;
}

function KeyedEditPage({ resources }: { resources: Resource[] }) {
  const { resource, id } = useParams();
  return <EditPage key={`${resource}:${id ?? ''}`} resources={resources} />;
}
