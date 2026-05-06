import { useEffect, useState } from 'react';
import { Refine } from '@refinedev/core';
import { ThemedLayoutV2, ThemedSiderV2, useNotificationProvider } from '@refinedev/antd';
import '@refinedev/antd/dist/reset.css';
import './index.css';
import { ConfigProvider, Layout, Input, Typography } from 'antd';
import dataProvider from '@refinedev/simple-rest';
import routerProvider from '@refinedev/react-router';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import type { Resource } from './types';
import { ListPage, ShowPage, EditPage, CreatePage, Welcome } from './pages';
import { iconFor } from './icons';
import { shadcnTheme } from './theme';

const API = '/admin-api';

const http = axios.create();
http.interceptors.request.use((config) => {
  const userId = localStorage.getItem('colyseus-admin-user-id') ?? '';
  if (userId) { config.headers.set('X-User-Id', userId); }
  return config;
});

const provider = dataProvider(API, http);

export function App() {
  const [resources, setResources] = useState<Resource[]>([]);

  useEffect(() => {
    fetch(API).then((r) => r.json()).then(setResources);
  }, []);

  if (resources.length === 0) {
    return <div data-testid="loading" style={{ padding: 24 }}>loading resources…</div>;
  }

  return (
    <BrowserRouter basename="/admin">
      <ConfigProvider theme={shadcnTheme}>
        <Refine
          dataProvider={provider}
          routerProvider={routerProvider}
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
              <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>acting as user-id:</Typography.Text>
                <UserIdInput />
              </Layout.Header>
            )}
          >
            <Routes>
              <Route path="/" element={<Welcome resources={resources} />} />
              <Route path=":resource" element={<ListPage resources={resources} />} />
              <Route path=":resource/show/:id" element={<ShowPage resources={resources} />} />
              <Route path=":resource/edit/:id" element={<EditPage resources={resources} />} />
              <Route path=":resource/create" element={<CreatePage resources={resources} />} />
            </Routes>
          </ThemedLayoutV2>
        </Refine>
      </ConfigProvider>
    </BrowserRouter>
  );
}

function UserIdInput() {
  const [v, setV] = useState<string>(() => localStorage.getItem('colyseus-admin-user-id') ?? '');
  useEffect(() => { localStorage.setItem('colyseus-admin-user-id', v); }, [v]);
  return (
    <Input
      size="small"
      style={{ width: 360, fontFamily: 'monospace' }}
      value={v}
      onChange={(e) => setV(e.target.value)}
      data-testid="user-id-input"
      placeholder="(no auth — set a user id)"
    />
  );
}
