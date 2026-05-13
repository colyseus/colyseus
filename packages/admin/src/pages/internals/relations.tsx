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
import { Eye, Loader2, Pencil, Plus } from 'lucide-react';
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
import { iconFor } from '../../icons';

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

export function RelationTabLabel({
  relation, count, targetIcon,
}: {
  relation: ResourceRelation;
  count: number | undefined;
  /** Lucide icon id from the target resource's catalog entry. When
   *  omitted the label renders without an icon — same surface as
   *  before, so non-relation use sites stay opt-in. */
  targetIcon?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`tab-relation-${relation.name}`}>
      {targetIcon && iconFor(targetIcon)}
      <span>
        {relation.label}{count !== undefined ? ` (${count})` : ''}
      </span>
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

  return (
    <RelatedTableView
      parentResource={parentResource}
      parentId={parentId}
      relation={relation}
      targetDef={targetDef}
      rows={rows}
      loading={loading}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
    />
  );
}

/**
 * Pure render of the related-rows table. Extracted from `RelatedTable`
 * so the markup is reachable from `react-dom/server.renderToString`
 * without driving the data-fetch effect — which keeps the
 * eye-button / link-href / column-shape behavior covered by node:test
 * unit tests in `test/related-table.test.tsx` instead of requiring
 * a jsdom + Testing-Library setup.
 */
export function RelatedTableView({
  parentResource, parentId, relation, targetDef,
  rows, loading, total, page, pageSize, onPageChange,
}: {
  parentResource: string;
  parentId: string;
  relation: ResourceRelation;
  targetDef: Resource;
  rows: any[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
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
                {/* Action column for the View + Edit affordances —
                    separate from the data cells so an FK column's own
                    linkTo doesn't fight the row-level navigation
                    (clicking an inner anchor inside a wrapping anchor
                    always wins, which previously stole drill-in clicks
                    on composite-PK rows). */}
                <TableHead className="w-24" aria-label="" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const childId = rowId(targetDef, row);
                return (
                <TableRow key={childId ?? i}>
                  {cols.map((c) => (
                    <TableCell key={c.name}>{formatCell(row[c.name], c)}</TableCell>
                  ))}
                  <TableCell className="w-24 text-right">
                    {childId && (
                      <div className="inline-flex items-center gap-1">
                        <Button
                          asChild variant="ghost" size="icon"
                          data-testid={`related-view-${relation.name}-${childId}`}
                        >
                          <Link
                            to={`/${parentResource}/show/${parentId}/${relation.name}/${childId}`}
                            aria-label={`View ${targetDef.label}`}
                          >
                            <Eye className="size-4" />
                          </Link>
                        </Button>
                        {/* Edit jumps to the standalone form but carries
                            `returnTo` so Save and the back-arrow both
                            return the user to this tab. */}
                        <Button
                          asChild variant="ghost" size="icon"
                          data-testid={`related-edit-${relation.name}-${childId}`}
                        >
                          <Link
                            to={`/${relation.target}/edit/${encodeURIComponent(childId)}?returnTo=${encodeURIComponent(`/${parentResource}/show/${parentId}/${relation.name}`)}`}
                            aria-label={`Edit ${targetDef.label}`}
                          >
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {total > pageSize && (
          <Pagination current={page} pageSize={pageSize} total={total} onChange={onPageChange} />
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
