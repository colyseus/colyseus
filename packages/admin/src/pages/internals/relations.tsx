/**
 * Show/Edit page extras around relations:
 *  - Profilerow: dt/dd grid pair
 *  - useRelationCounts: single bulk fetch for all many-relation tab labels
 *  - RelationTabLabel: small wrapper that displays the count
 *  - RelatedTable: paginated mini-table inside a many-relation tab
 *  - OneRelationLink: small badge linking to the one-relation target
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { type Resource, type ResourceRelation, singlePk, rowId } from '../../types';
import { findResource, pickLabelColumn, visibleColumns } from './helpers';
import { formatCell } from './format-cell';
import { Pagination } from './pagination';

export function Profilerow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

/**
 * Single fetch for all many-relation counts on a resource detail page.
 * Replaces N per-tab `_start=0&_end=1` calls with one request — server
 * runs the per-relation count(*)s in Promise.all. Returns `null` while
 * the request is in flight so labels can hide the count until it lands.
 */
export function useRelationCounts(
  resource: string | undefined,
  id: string | undefined,
): Record<string, number> | null {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!resource || !id) { return; }
    let cancelled = false;
    fetch(`/admin-api/${resource}/${encodeURIComponent(id)}/_counts`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) { setCounts(data); } })
      .catch(() => { if (!cancelled) { setCounts(null); } });
    return () => { cancelled = true; };
  }, [resource, id]);
  return counts;
}

export function RelationTabLabel({ relation, count }: { relation: ResourceRelation; count: number | undefined }) {
  return (
    <span data-testid={`tab-relation-${relation.name}`}>
      {relation.label}{count !== undefined ? ` (${count})` : ''}
    </span>
  );
}

export function RelatedTable({
  parentResource, parentId, relation, resources,
}: {
  parentResource: string; parentId: string; relation: ResourceRelation; resources: Resource[];
}) {
  const targetDef = findResource(resources, relation.target);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    const start = (page - 1) * pageSize;
    fetch(
      `/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=${start}&_end=${start + pageSize}`,
      { credentials: 'include' },
    )
      .then(async (r) => {
        if (!r.ok) { return { rows: [] as any[], total: 0 }; }
        const totalHeader = r.headers.get('x-total-count');
        return { rows: await r.json() as any[], total: totalHeader ? Number(totalHeader) : 0 };
      })
      .then(({ rows, total }) => { setRows(rows); setTotal(total); })
      .finally(() => setLoading(false));
  }, [parentResource, parentId, relation.name, page]);

  if (!targetDef) { return <Empty title={`unknown target resource '${relation.target}'`} />; }

  const targetPk = singlePk(targetDef);
  const cols = visibleColumns(targetDef, targetDef.listColumns);
  const newHref = `/${relation.target}/create?_prefill_${relation.fk}=${encodeURIComponent(parentId)}`;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button asChild size="sm" variant="outline" data-testid={`new-related-${relation.name}`}>
          <Link to={newHref}><Plus />New {targetDef.label}</Link>
        </Button>
      </div>
      <div data-testid={`related-${relation.name}`}>
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" />
          </div>
        ) : rows.length === 0 ? (
          <Empty title={`no ${targetDef.label.toLowerCase()} yet`}>
            <Button asChild size="sm" variant="outline">
              <Link to={newHref}><Plus />Create one</Link>
            </Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (<TableHead key={c.name}>{c.name}</TableHead>))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const childId = rowId(targetDef, row);
                return (
                <TableRow key={childId ?? i}>
                  {cols.map((c) => (
                    <TableCell key={c.name}>
                      {/*
                        Link to the related row's show page. For single-PK
                        targets the PK column itself becomes a link; for
                        composite-PK targets we attach the link to the first
                        column of the projection so support agents always
                        have a way to navigate.
                      */}
                      {childId && (targetPk ? c.name === targetPk : c.name === cols[0]!.name)
                        ? <Link to={`/${relation.target}/show/${childId}`} className="text-primary hover:underline">{formatCell(row[c.name], c)}</Link>
                        : formatCell(row[c.name], c)}
                    </TableCell>
                  ))}
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {total > pageSize && (
          <Pagination current={page} pageSize={pageSize} total={total} onChange={setPage} />
        )}
      </div>
    </div>
  );
}

export function OneRelationLink({
  parentResource, parentId, relation, resources,
}: {
  parentResource: string; parentId: string; relation: ResourceRelation; resources: Resource[];
}) {
  const targetDef = findResource(resources, relation.target);
  const [row, setRow] = useState<any | null>(null);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    fetch(`/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=0&_end=1`, {
      credentials: 'include',
    })
      .then(async (r) => (r.ok ? (await r.json()) as any[] : []))
      .then((rows) => {
        if (rows.length === 0) { setEmpty(true); }
        else { setRow(rows[0]); }
      })
      .catch(() => setEmpty(true));
  }, [parentResource, parentId, relation.name]);

  if (empty) { return <Badge variant="secondary">{relation.label}: <em className="not-italic ml-1 text-muted-foreground">none</em></Badge>; }
  if (!row || !targetDef) { return <Badge variant="secondary">{relation.label}: …</Badge>; }
  const targetPk = singlePk(targetDef);
  if (!targetPk) { return <Badge variant="info">{relation.label}</Badge>; }
  // Prefer the target's label column for the badge text; fall back to the
  // raw PK so badges always say *something* useful. The fetch above already
  // returned the full row, so this adds zero queries.
  const labelCol = pickLabelColumn(targetDef);
  const display = (labelCol && row[labelCol] != null && row[labelCol] !== '')
    ? String(row[labelCol])
    : String(row[targetPk]);
  return (
    <Link to={`/${relation.target}/show/${row[targetPk]}`} data-testid={`one-relation-${relation.name}`}>
      <Badge variant="info" className="hover:opacity-90">{relation.label}: {display}</Badge>
    </Link>
  );
}
