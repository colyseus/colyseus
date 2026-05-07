import { useEffect, useState } from 'react';
import { Authenticated, Refine } from '@refinedev/core';
import { ThemedLayoutV2, ThemedSiderV2, useNotificationProvider } from '@refinedev/antd';
import '@refinedev/antd/dist/reset.css';
import './index.css';
import { ConfigProvider, Layout } from 'antd';
import dataProvider from '@refinedev/simple-rest';
import routerProvider from '@refinedev/react-router';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import axios from 'axios';
import type { Resource } from './types';
import { ListPage, ShowPage, EditPage, CreatePage, Welcome } from './pages';
import { iconFor } from './icons';
import { shadcnTheme } from './theme';
import { authProvider } from './authProvider';
import { LoginPage } from './LoginPage';
import { SetupPage } from './SetupPage';
import { SignInGate } from './SignInGate';
import { UserHeader } from './UserHeader';

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
    <BrowserRouter basename="/admin">
      <ConfigProvider theme={shadcnTheme}>
        <Refine
          dataProvider={provider}
          routerProvider={routerProvider}
          authProvider={authProvider}
          notificationProvider={useNotificationProvider}
          options={{ syncWithLocation: true, warnWhenUnsavedChanges: false }}
          resources={resources.map((r) => ({
            name: r.name,
            list: `/${r.name}`,
            show: `/${r.name}/show/:id`,
            edit: `/${r.name}/edit/:id`,
            create: `/${r.name}/create`,
            meta: { label: r.label, icon: iconFor(r.icon) },
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
              <Route path="/" element={<Welcome resources={resources} />} />
              <Route path=":resource" element={<ListPage resources={resources} />} />
              <Route path=":resource/show/:id" element={<ShowPage resources={resources} />} />
              <Route path=":resource/edit/:id" element={<EditPage resources={resources} />} />
              <Route path=":resource/create" element={<CreatePage resources={resources} />} />
            </Route>
          </Routes>
        </Refine>
      </ConfigProvider>
    </BrowserRouter>
  );
}

function ProtectedShell({ resources: _ }: { resources: Resource[] }) {
  return (
    <ThemedLayoutV2
      Sider={() => (
        <ThemedSiderV2
          Title={({ collapsed }) => (
            <div style={{ padding: '12px 16px', fontWeight: 600, color: '#09090b', letterSpacing: -0.2 }}>
              {collapsed ? 'C' : 'Colyseus'}
            </div>
          )}
        />
      )}
      Header={() => (
        <Layout.Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          <UserHeader />
        </Layout.Header>
      )}
    >
      <Outlet />
    </ThemedLayoutV2>
  );
}
