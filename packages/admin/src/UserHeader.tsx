/**
 * Header strip showing the signed-in identity + logout button.
 *
 * Replaces the previous dev-only "acting as user-id" input. That input
 * is still available behind ?dev=1 (e.g. for puppeteer tests that want
 * to swap roles fast without going through login).
 */
import { useGetIdentity, useLogout } from '@refinedev/core';
import { Button, Space, Tag, Typography, Input } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';

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

  return (
    <Space size="middle">
      {isDev && <DevImpersonateInput />}
      <Tag color={
        identity.role === 'admin' ? 'green' :
        identity.role === 'mod' ? 'blue' : 'default'
      }>
        {identity.role}
      </Tag>
      <Typography.Text type="secondary" style={{ fontSize: 13, fontFamily: 'monospace' }}>
        {identity.userId}
      </Typography.Text>
      <Button
        size="small"
        icon={<LogoutOutlined />}
        onClick={() => logout()}
        data-testid="logout-button"
      >
        Sign out
      </Button>
    </Space>
  );
}

function DevImpersonateInput() {
  const [v, setV] = useState<string>(() => localStorage.getItem('colyseus-admin-user-id') ?? '');
  useEffect(() => { localStorage.setItem('colyseus-admin-user-id', v); }, [v]);
  return (
    <Input
      size="small"
      style={{ width: 320, fontFamily: 'monospace' }}
      value={v}
      onChange={(e) => setV(e.target.value)}
      data-testid="user-id-input"
      placeholder="dev: X-User-Id override"
    />
  );
}
