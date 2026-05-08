import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Typography, Table, List, Tag, Empty, Alert } from 'antd';
import { iconFor } from './icons';

interface Widget {
  id: string;
  title: string;
  icon?: string;
  render: 'kpi' | 'table' | 'list' | 'json';
  span: number;
  data: any;
  error?: string;
}

interface DashboardPayload {
  widgets: Widget[];
}

function KpiCard({ data }: { data: Record<string, number | string> }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) { return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="no data" />; }
  return (
    <Row gutter={[12, 12]}>
      {entries.map(([k, v]) => (
        <Col key={k} xs={12} sm={8} md={6}>
          <Statistic title={k} value={v as any} />
        </Col>
      ))}
    </Row>
  );
}

function TableCard({ data }: { data: { columns: string[]; rows: any[] } }) {
  if (!data || !data.rows || data.rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="no rows" />;
  }
  const cols = (data.columns ?? Object.keys(data.rows[0] ?? {})).map((c) => ({
    key: c,
    title: c,
    dataIndex: c,
    render: (v: any) =>
      v == null ? <Tag>null</Tag>
      : typeof v === 'object' ? <code style={{ fontSize: 11 }}>{JSON.stringify(v)}</code>
      : String(v),
  }));
  return (
    <Table
      size="small"
      pagination={false}
      rowKey={(r, i) => (r?.id ?? i) as any}
      columns={cols}
      dataSource={data.rows}
      scroll={{ x: true }}
    />
  );
}

function ListCard({ data }: { data: Array<{ title: string; description?: string }> }) {
  if (!data || data.length === 0) { return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="empty" />; }
  return (
    <List
      size="small"
      dataSource={data}
      renderItem={(item) => (
        <List.Item>
          <List.Item.Meta title={item.title} description={item.description} />
        </List.Item>
      )}
    />
  );
}

function JsonCard({ data }: { data: any }) {
  return (
    <pre style={{ margin: 0, fontSize: 12, maxHeight: 240, overflow: 'auto' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function WidgetCard({ widget }: { widget: Widget }) {
  // iconFor returns a React element (e.g. <UserOutlined />) — render it
  // directly, not as a component.
  const iconEl = widget.icon ? iconFor(widget.icon) : null;
  const titleNode = (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {iconEl}{widget.title}
    </span>
  );

  let body: React.ReactNode;
  if (widget.error) {
    body = <Alert type="error" showIcon message={widget.error} />;
  } else {
    switch (widget.render) {
      case 'kpi': body = <KpiCard data={widget.data} />; break;
      case 'table': body = <TableCard data={widget.data} />; break;
      case 'list': body = <ListCard data={widget.data} />; break;
      default: body = <JsonCard data={widget.data} />;
    }
  }

  return (
    <Card
      title={titleNode}
      size="small"
      data-testid={`widget-${widget.id}`}
      styles={{ body: { padding: 12 } }}
    >
      {body}
    </Card>
  );
}

export function Dashboard() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/admin-api/_dashboard', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) { throw new Error(`/_dashboard returned ${r.status}`); }
        return r.json() as Promise<DashboardPayload>;
      })
      .then(setPayload)
      .catch((e) => setError(e?.message ?? String(e)));
  }, []);

  if (error) {
    return (
      <div data-testid="dashboard">
        <Alert type="error" showIcon message="Failed to load dashboard" description={error} />
      </div>
    );
  }
  if (payload === null) {
    return (
      <div data-testid="dashboard" style={{ color: '#71717a' }}>loading dashboard…</div>
    );
  }

  return (
    <div data-testid="dashboard" style={{ padding: 0 }}>
      <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 16 }}>Dashboard</Typography.Title>
      <Row gutter={[16, 16]}>
        {payload.widgets.map((w) => (
          <Col key={w.id} xs={24} md={w.span}>
            <WidgetCard widget={w} />
          </Col>
        ))}
      </Row>
    </div>
  );
}
