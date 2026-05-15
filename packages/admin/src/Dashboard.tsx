import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { humanize } from '../src-backend/display/humanize.js';
import { iconFor } from './icons';
import { syntheticShowPath } from './pages/internals/synthetic-resources';

interface Widget {
  id: string;
  title: string;
  icon?: string;
  render: 'kpi' | 'table' | 'list' | 'json';
  span: number;
  /** When > 0, the card self-refreshes from /admin-api/_dashboard/<id> on this cadence. */
  refreshIntervalMs?: number;
  data: any;
  error?: string;
}

interface DashboardPayload {
  widgets: Widget[];
}

function KpiCard({ data }: { data: Record<string, number | string> }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground">no data</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map(([k, v]) => (
        <div key={k} className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
          <div className="text-2xl font-semibold tabular-nums">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

interface TableData {
  columns: string[];
  rows: Array<Record<string, any>>;
  /** When present, rows navigate to /{resource}/show/{row[idColumn]}. */
  linkTo?: { resource: string; idColumn?: string };
}

function TableCard({ data }: { data: TableData }) {
  const navigate = useNavigate();
  if (!data || !data.rows || data.rows.length === 0) {
    return <div className="text-sm text-muted-foreground">no rows</div>;
  }
  const cols = data.columns ?? Object.keys(data.rows[0] ?? {});
  const idColumn = data.linkTo?.idColumn ?? 'id';
  const resource = data.linkTo?.resource;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {cols.map((c) => (
            <TableHead key={c} className="text-xs">{humanize(c)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.rows.map((r, i) => {
          const id = resource ? r[idColumn] : undefined;
          // Synthetic resources (rooms, …) use custom URLs without `/show/`;
          // fall back to the standard CRUD pattern for catalog resources.
          const target = (resource && id != null)
            ? (syntheticShowPath(resource, String(id))
                ?? `/${resource}/show/${encodeURIComponent(String(id))}`)
            : undefined;
          const onClick = target ? () => navigate(target) : undefined;
          return (
            <TableRow
              key={id ?? i}
              data-row-id={id ?? undefined}
              onClick={onClick}
              className={onClick ? 'cursor-pointer hover:bg-muted/40' : undefined}
            >
              {cols.map((c) => (
                <TableCell key={c} className="text-xs">{formatCell(r[c])}</TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ListCard({ data }: { data: Array<{ title: string; description?: string }> }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground">empty</div>;
  }
  return (
    <ul className="divide-y">
      {data.map((item, i) => (
        <li key={i} className="py-2">
          <div className="font-medium text-sm">{item.title}</div>
          {item.description && (
            <div className="text-xs text-muted-foreground">{item.description}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

function JsonCard({ data }: { data: any }) {
  return (
    <pre className="m-0 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function formatCell(v: any): React.ReactNode {
  if (v == null) { return <span className="text-muted-foreground">—</span>; }
  if (typeof v === 'object') {
    return <code className="text-xs text-muted-foreground">{JSON.stringify(v).slice(0, 60)}</code>;
  }
  return String(v);
}

function WidgetCard({ widget: initial }: { widget: Widget }) {
  // Local state lets widgets with `refreshIntervalMs` swap in fresh
  // data without re-fetching the whole dashboard. `initial` is the
  // last server-rendered snapshot; if it changes (e.g. dashboard
  // re-mount), we adopt it as the new baseline.
  const [widget, setWidget] = useState(initial);
  useEffect(() => { setWidget(initial); }, [initial]);

  useEffect(() => {
    const ms = widget.refreshIntervalMs;
    if (!ms || ms <= 0) { return; }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `/admin-api/_dashboard/${encodeURIComponent(widget.id)}`,
          { credentials: 'include' },
        );
        if (!r.ok) { return; }
        const next = await r.json() as Widget;
        if (!cancelled) { setWidget(next); }
      } catch {
        // transient network errors: skip this tick, keep the last good payload
      }
    };
    const handle = setInterval(tick, ms);
    return () => { cancelled = true; clearInterval(handle); };
  }, [widget.id, widget.refreshIntervalMs]);

  let body: React.ReactNode;
  if (widget.error) {
    body = (
      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <span>{widget.error}</span>
      </div>
    );
  } else {
    switch (widget.render) {
      case 'kpi': body = <KpiCard data={widget.data} />; break;
      case 'table': body = <TableCard data={widget.data} />; break;
      case 'list': body = <ListCard data={widget.data} />; break;
      default: body = <JsonCard data={widget.data} />;
    }
  }
  return (
    <Card data-testid={`widget-${widget.id}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {widget.icon ? iconFor(widget.icon) : null}
          {widget.title}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

/**
 * Convert the backend widget span (1-24 AntD col) into a Tailwind class for
 * a 12-column grid. Widgets ≤ 12 take their span; > 12 spans the full row.
 */
function spanClass(span: number): string {
  const n = span >= 24 ? 12 : Math.max(1, Math.round((span / 24) * 12));
  // Tailwind needs the full class string at compile time, so explicit map.
  const map: Record<number, string> = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
  };
  return map[n] ?? 'md:col-span-12';
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
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Failed to load dashboard</div>
            <div className="text-xs opacity-80">{error}</div>
          </div>
        </div>
      </div>
    );
  }
  if (payload === null) {
    return <div data-testid="dashboard" className="text-sm text-muted-foreground">loading dashboard…</div>;
  }

  return (
    <div data-testid="dashboard">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        {payload.widgets.map((w) => (
          <div key={w.id} className={spanClass(w.span)}>
            <WidgetCard widget={w} />
          </div>
        ))}
      </div>
    </div>
  );
}
