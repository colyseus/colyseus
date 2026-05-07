/**
 * Bare-bones login screen. Email + password → POST /admin-api/auth/login.
 * On first run (no admins exist), Refine's authProvider.check() routes the
 * unauthenticated user to /setup instead — see SetupPage.tsx.
 */
import { useState } from 'react';
import { useLogin } from '@refinedev/core';
import { Card, Form, Input, Button, Typography, Alert, Space } from 'antd';

export function LoginPage() {
  const { mutate: login, isLoading } = useLogin();
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fafafa' }}>
      <Card style={{ width: 380 }} data-testid="login-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>Sign in</Typography.Title>
          <Typography.Text type="secondary">Colyseus Admin</Typography.Text>
          {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}
          <Form
            layout="vertical"
            onFinish={(values) =>
              login(values, {
                onSuccess: (data) => {
                  if (data?.success === false) {
                    setError(data.error?.message ?? 'Sign in failed');
                  }
                },
              })
            }
          >
            <Form.Item
              label="Email"
              name="email"
              rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}
            >
              <Input data-testid="login-email" autoComplete="email" autoFocus />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, message: 'Enter your password' }]}
            >
              <Input.Password data-testid="login-password" autoComplete="current-password" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={isLoading}
              block
              data-testid="login-submit"
            >
              Sign in
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
