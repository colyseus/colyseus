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
import { Card, Form, Input, Button, Typography, Alert, Space } from 'antd';

export function SetupPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fafafa' }}>
      <Card style={{ width: 420 }} data-testid="setup-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>Welcome — create the first admin</Typography.Title>
          <Typography.Text type="secondary">
            This panel doesn't have any administrator yet. The account you create here will own the database.
          </Typography.Text>
          {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}
          <Form
            layout="vertical"
            onFinish={async (values) => {
              setBusy(true);
              setError(null);
              try {
                const res = await fetch('/admin-api/auth/bootstrap', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(values),
                });
                if (res.ok) {
                  navigate('/', { replace: true });
                  return;
                }
                const body = await res.json().catch(() => ({}));
                setError(body.error || `Setup failed (${res.status})`);
              } catch (e: any) {
                setError(e?.message ?? 'Setup failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item
              label="Admin email"
              name="email"
              rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}
            >
              <Input data-testid="setup-email" autoComplete="email" autoFocus />
            </Form.Item>
            <Form.Item
              label="Password"
              name="password"
              rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
              extra="Choose something strong — there's no recovery flow yet."
            >
              <Input.Password data-testid="setup-password" autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy} block data-testid="setup-submit">
              Create admin
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
