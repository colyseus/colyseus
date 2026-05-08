/**
 * List / Show / Edit / Create — the four CRUD pages every resource gets.
 * shadcn/Tailwind via plain Radix primitives + headless refine hooks
 * (@refinedev/core). The previous implementation leaned heavily on
 * @refinedev/antd's page wrappers + AntD Table/Form; those are gone.
 *
 * Shape kept stable from the AntD version:
 *  - ListPage: search bar + per-column filter dropdowns + paginated table
 *  - ShowPage: tabs — Profile + per-many-relation paginated mini-table
 *  - EditPage: same tabs as Show, Profile is editable form
 *  - CreatePage: form, optional `?_prefill_<col>=<val>` seeds initial values
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useList,
  useTable,
  useOne,
  useUpdate,
  useCreate,
  useDelete,
  useNotification,
} from '@refinedev/core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  Filter as FilterIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Page } from '@/components/ui/page';
import { Empty } from '@/components/ui/empty';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  type Column, type Resource, type ResourceRelation,
  singlePk, isJsonish, isNumeric, isDate, isBoolean,
} from './types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------

function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const dir = seconds >= 0 ? 'ago' : 'from now';
  if (abs < 60) { return `just now`; }
  if (abs < 3600) { return `${Math.round(abs / 60)} min ${dir}`; }
  if (abs < 86_400) { return `${Math.round(abs / 3600)} hr ${dir}`; }
  if (abs < 30 * 86_400) { return `${Math.round(abs / 86_400)} d ${dir}`; }
  return date.toISOString().slice(0, 10);
}

function formatCell(v: any, c?: Column): React.ReactNode {
  if (v == null) { return <span className="text-muted-foreground">—</span>; }

  if (c && isBoolean(c)) {
    const b = v === true || v === 1 || v === '1' || v === 'true';
    return <Badge variant={b ? 'success' : 'secondary'}>{b ? 'Yes' : 'No'}</Badge>;
  }

  if (c && isDate(c)) {
    const d = v instanceof Date ? v : new Date(v);
    if (!isNaN(d.getTime())) {
      return <span title={d.toISOString()}>{relativeTime(d)}</span>;
    }
    return String(v);
  }

  if (c && isNumeric(c) && typeof v === 'number') {
    return (
      <span className="tabular-nums">
        {Number.isInteger(v) ? v.toLocaleString() : v.toString()}
      </span>
    );
  }

  if (typeof v === 'object' || (c && isJsonish(c) && typeof v === 'string')) {
    const obj = typeof v === 'string' ? safeParseJson(v) : v;
    const json = JSON.stringify(obj);
    return (
      <code
        className="text-xs text-muted-foreground"
        title={JSON.stringify(obj, null, 2)}
      >
        {json.slice(0, 60)}{json.length > 60 ? '…' : ''}
      </code>
    );
  }

  const s = String(v);
  if (s.length > 24 && !/\s/.test(s)) {
    return (
      <span
        className="font-mono text-xs cursor-pointer"
        title={s}
        onClick={() => { navigator.clipboard.writeText(s).catch(() => {}); }}
      >
        {s.slice(0, 8)}…{s.slice(-4)}
      </span>
    );
  }

  return s;
}

function safeParseJson(raw: string): any {
  try { return JSON.parse(raw); } catch { return raw; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findResource(resources: Resource[], name?: string): Resource | undefined {
  return resources.find((r) => r.name === name);
}

function visibleColumns(def: Resource, subset: string[] | undefined): Column[] {
  if (!subset || subset.length === 0) { return def.columns; }
  const order = new Map(subset.map((n, i) => [n, i]));
  return def.columns
    .filter((c) => order.has(c.name))
    .sort((a, b) => order.get(a.name)! - order.get(b.name)!);
}

function pickLabelColumn(def: Resource): string | null {
  const colNames = def.columns.map((c) => c.name);
  for (const candidate of ['display_name', 'name', 'email', 'title']) {
    if (colNames.includes(candidate)) { return candidate; }
  }
  const firstText = def.columns.find((c) =>
    !c.primary && (c.dataType === 'string' || /^(text|varchar|char)/i.test(c.type)),
  );
  return firstText?.name ?? null;
}

// ---------------------------------------------------------------------------
// ListPage
// ---------------------------------------------------------------------------

export function ListPage({ resources }: { resources: Resource[] }) {
  const { resource: resourceName } = useParams();
  const def = findResource(resources, resourceName);
  const pk = def && singlePk(def);

  const {
    tableQuery, current, setCurrent, pageSize,
    sorters, setSorters, filters, setFilters,
  } = useTable({ resource: resourceName, syncWithLocation: true });

  if (!def) { return <div data-testid="unknown">unknown resource: {resourceName}</div>; }

  const cols = visibleColumns(def, def.listColumns);
  const rowActions = def.actions.filter((a) => a.perRow);
  const toolbarActions = def.actions.filter((a) => !a.perRow);
  const currentQ = (filters?.find?.((f: any) => f.field === '_q') as any)?.value ?? '';
  const rows = (tableQuery?.data?.data ?? []) as any[];
  const total = tableQuery?.data?.total ?? 0;

  return (
    <Page
      title={def.label}
      actions={
        <div className="flex items-center gap-2">
          <SearchInput
            resourceName={resourceName!}
            currentValue={currentQ}
            onApply={(value) => {
              const trimmed = value.trim();
              setFilters(
                trimmed.length === 0
                  ? [{ field: '_q', operator: 'eq', value: undefined } as any]
                  : [{ field: '_q', operator: 'eq', value: trimmed } as any],
                'replace',
              );
            }}
          />
          {toolbarActions.map((a) => (
            <ActionButton
              key={a.name}
              resource={resourceName!}
              action={a}
              onComplete={() => tableQuery?.refetch()}
            />
          ))}
          <Button asChild size="sm">
            <Link to={`/${resourceName}/create`}>
              <Plus />
              New
            </Link>
          </Button>
        </div>
      }
    >
      <div data-testid={`list-${resourceName}`}>
        {tableQuery?.isLoading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin mr-2" /> loading…
          </div>
        ) : rows.length === 0 ? (
          <Empty
            title={
              currentQ
                ? `no ${def.label.toLowerCase()} matching "${currentQ}"`
                : `no ${def.label.toLowerCase()} yet`
            }
          >
            {!currentQ && (
              <Button asChild size="sm">
                <Link to={`/${resourceName}/create`}>
                  <Plus />
                  Create one
                </Link>
              </Button>
            )}
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c.name}>
                    <ColumnHeader
                      column={c}
                      sorters={sorters}
                      setSorters={setSorters}
                      filters={filters}
                      setFilters={setFilters}
                    />
                  </TableHead>
                ))}
                {pk && <TableHead className="w-[1%] whitespace-nowrap text-right">actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow
                  key={pk ? row[pk] : i}
                  data-testid={pk ? `row-${row[pk]}` : undefined}
                  data-row-id={pk ? String(row[pk]) : undefined}
                >
                  {cols.map((c) => (
                    <TableCell key={c.name}>{formatCell(row[c.name], c)}</TableCell>
                  ))}
                  {pk && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link to={`/${resourceName}/show/${row[pk]}`} aria-label="view">
                            <Eye />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon">
                          <Link to={`/${resourceName}/edit/${row[pk]}`} aria-label="edit">
                            <Pencil />
                          </Link>
                        </Button>
                        <DeleteRowButton
                          resource={resourceName!}
                          id={row[pk]}
                          onDeleted={() => tableQuery?.refetch()}
                        />
                        {rowActions.map((a) => (
                          <ActionButton
                            key={a.name}
                            resource={resourceName!}
                            action={a}
                            rowId={String(row[pk])}
                            onComplete={() => tableQuery?.refetch()}
                          />
                        ))}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {total > pageSize && (
          <Pagination
            current={current}
            pageSize={pageSize}
            total={total}
            onChange={setCurrent}
          />
        )}
      </div>
    </Page>
  );
}

function SearchInput({
  resourceName, currentValue, onApply,
}: { resourceName: string; currentValue: string; onApply: (v: string) => void }) {
  const [v, setV] = useState(currentValue);
  useEffect(() => { setV(currentValue); }, [currentValue]);
  return (
    <span data-testid={`search-${resourceName}`} className="relative inline-block w-60">
      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onApply(v); }
        }}
        onBlur={() => { if (v !== currentValue) { onApply(v); } }}
        placeholder="Search…"
        className="pl-8"
      />
    </span>
  );
}

function Pagination({ current, pageSize, total, onChange }: {
  current: number; pageSize: number; total: number; onChange: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <div>
        Page {current} of {pages} · {total.toLocaleString()} rows
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border bg-muted px-3 text-sm font-medium text-foreground">
          {current}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={current >= pages}
          onClick={() => onChange(current + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function ColumnHeader({
  column: c, sorters, setSorters, filters, setFilters,
}: {
  column: Column;
  sorters: any[] | undefined;
  setSorters: (s: any[]) => void;
  filters: any[] | undefined;
  setFilters: (f: any[], behavior?: 'merge' | 'replace') => void;
}) {
  const sort = sorters?.find((s) => s.field === c.name);
  const cycle = () => {
    if (!sort) { setSorters([{ field: c.name, order: 'asc' }]); }
    else if (sort.order === 'asc') { setSorters([{ field: c.name, order: 'desc' }]); }
    else { setSorters([]); }
  };
  const filterCount = (filters ?? []).filter((f: any) =>
    f.field === c.name || (typeof f.field === 'string' && f.field.startsWith(`${c.name}_`)),
  ).length;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={cycle}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-accent-foreground"
      >
        <span>{c.name}</span>
        {sort?.order === 'asc' ? <ArrowUp className="size-3" />
          : sort?.order === 'desc' ? <ArrowDown className="size-3" />
          : <ChevronsUpDown className="size-3 opacity-40" />}
      </button>
      {!isJsonish(c) && (
        <ColumnFilter c={c} filters={filters} setFilters={setFilters} active={filterCount > 0} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-column filter dropdowns
// ---------------------------------------------------------------------------

type SetFilters = (filters: any[], behavior?: 'merge' | 'replace') => void;

function replaceColumnFilters(
  setFilters: SetFilters, filters: any[] | undefined, field: string, next: any[],
) {
  const others = (filters ?? []).filter((f: any) => {
    return !(f.field === field || (typeof f.field === 'string' && f.field.startsWith(`${field}_`)));
  });
  setFilters([...others, ...next], 'replace');
}

function ColumnFilter({ c, filters, setFilters, active }: {
  c: Column; filters: any[] | undefined; setFilters: SetFilters; active: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center justify-center rounded px-1.5 hover:bg-accent',
            active && 'text-foreground bg-accent',
          )}
          aria-label={`filter ${c.name}`}
        >
          <FilterIcon className={cn('size-3', active ? 'opacity-100' : 'opacity-40')} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        {isBoolean(c) ? (
          <BooleanFilter colName={c.name} filters={filters} setFilters={setFilters} />
        ) : isDate(c) ? (
          <DateFilter colName={c.name} filters={filters} setFilters={setFilters} />
        ) : isNumeric(c) ? (
          <NumberFilter colName={c.name} filters={filters} setFilters={setFilters} />
        ) : (
          <TextFilter colName={c.name} filters={filters} setFilters={setFilters} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function TextFilter({ colName, filters, setFilters }: {
  colName: string; filters: any[] | undefined; setFilters: SetFilters;
}) {
  const current = (filters ?? []).find((f: any) => f.field === `${colName}_like`)?.value ?? '';
  const [value, setValue] = useState<string>(String(current));
  const apply = () => {
    const trimmed = value.trim();
    replaceColumnFilters(setFilters, filters, colName,
      trimmed.length === 0 ? [] : [{ field: `${colName}_like`, operator: 'eq', value: trimmed }],
    );
  };
  const clear = () => { setValue(''); replaceColumnFilters(setFilters, filters, colName, []); };
  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { apply(); } }}
        placeholder={`Search ${colName}`}
        data-testid={`filter-text-${colName}`}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={apply}>Apply</Button>
        <Button size="sm" variant="outline" onClick={clear}>Reset</Button>
      </div>
    </div>
  );
}

function BooleanFilter({ colName, filters, setFilters }: {
  colName: string; filters: any[] | undefined; setFilters: SetFilters;
}) {
  const current = (filters ?? []).find((f: any) => f.field === colName)?.value;
  const set = (v: boolean | null) => {
    replaceColumnFilters(setFilters, filters, colName,
      v === null ? [] : [{ field: colName, operator: 'eq', value: v }],
    );
  };
  return (
    <div className="space-y-1">
      <Button className="w-full" size="sm" variant={current === true ? 'default' : 'outline'} onClick={() => set(true)}>Yes</Button>
      <Button className="w-full" size="sm" variant={current === false ? 'default' : 'outline'} onClick={() => set(false)}>No</Button>
      <Button className="w-full" size="sm" variant={current == null ? 'default' : 'outline'} onClick={() => set(null)}>Any</Button>
    </div>
  );
}

function NumberFilter({ colName, filters, setFilters }: {
  colName: string; filters: any[] | undefined; setFilters: SetFilters;
}) {
  const minCurrent = (filters ?? []).find((f: any) => f.field === `${colName}_gte`)?.value;
  const maxCurrent = (filters ?? []).find((f: any) => f.field === `${colName}_lte`)?.value;
  const [min, setMin] = useState<string>(minCurrent != null ? String(minCurrent) : '');
  const [max, setMax] = useState<string>(maxCurrent != null ? String(maxCurrent) : '');
  const apply = () => {
    const next: any[] = [];
    if (min !== '') { next.push({ field: `${colName}_gte`, operator: 'eq', value: Number(min) }); }
    if (max !== '') { next.push({ field: `${colName}_lte`, operator: 'eq', value: Number(max) }); }
    replaceColumnFilters(setFilters, filters, colName, next);
  };
  const clear = () => { setMin(''); setMax(''); replaceColumnFilters(setFilters, filters, colName, []); };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input type="number" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} />
        <Input type="number" placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={apply}>Apply</Button>
        <Button size="sm" variant="outline" onClick={clear}>Reset</Button>
      </div>
    </div>
  );
}

function DateFilter({ colName, filters, setFilters }: {
  colName: string; filters: any[] | undefined; setFilters: SetFilters;
}) {
  const startCurrent = (filters ?? []).find((f: any) => f.field === `${colName}_gte`)?.value;
  const endCurrent = (filters ?? []).find((f: any) => f.field === `${colName}_lte`)?.value;
  const [start, setStart] = useState<string>(startCurrent ? toLocalDate(startCurrent) : '');
  const [end, setEnd] = useState<string>(endCurrent ? toLocalDate(endCurrent) : '');
  const apply = () => {
    const next: any[] = [];
    if (start) { next.push({ field: `${colName}_gte`, operator: 'eq', value: new Date(start).toISOString() }); }
    if (end) { next.push({ field: `${colName}_lte`, operator: 'eq', value: new Date(end + 'T23:59:59').toISOString() }); }
    replaceColumnFilters(setFilters, filters, colName, next);
  };
  const clear = () => { setStart(''); setEnd(''); replaceColumnFilters(setFilters, filters, colName, []); };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={apply}>Apply</Button>
        <Button size="sm" variant="outline" onClick={clear}>Reset</Button>
      </div>
    </div>
  );
}

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Action button (with optional confirmation) + Delete
// ---------------------------------------------------------------------------

function ActionButton({ resource, action, rowId, onComplete }: {
  resource: string;
  action: { name: string; label: string; perRow: boolean; confirm?: { title?: string; description?: string } };
  rowId?: string;
  onComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { open } = useNotification();
  const run = async () => {
    setBusy(true);
    try {
      const headers: HeadersInit = { 'content-type': 'application/json' };
      const userId = localStorage.getItem('colyseus-admin-user-id') ?? '';
      if (userId) { (headers as any)['X-User-Id'] = userId; }
      const res = await fetch(`/admin-api/${resource}/_action/${action.name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rowId ? { id: rowId } : {}),
      });
      const text = await res.text();
      if (!res.ok) {
        open?.({ type: 'error', message: `${action.label} failed`, description: text });
      } else {
        open?.({ type: 'success', message: `${action.label} succeeded` });
        onComplete?.();
      }
    } finally { setBusy(false); }
  };

  const trigger = (
    <Button
      size="sm"
      variant="outline"
      data-testid={`action-${action.name}-${rowId ?? 'global'}`}
      disabled={busy}
      onClick={action.confirm ? undefined : run}
    >
      {busy && <Loader2 className="animate-spin" />}
      {action.label}
    </Button>
  );

  if (!action.confirm) { return trigger; }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.confirm.title ?? `Run "${action.label}"?`}</AlertDialogTitle>
          {action.confirm.description && (
            <AlertDialogDescription>{action.confirm.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={run}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteRowButton({ resource, id, onDeleted }: {
  resource: string; id: string; onDeleted: () => void;
}) {
  const { mutate: deleteRow } = useDelete();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="delete" data-testid={`delete-${id}`}>
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete row?</AlertDialogTitle>
          <AlertDialogDescription>This action can't be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => deleteRow(
              { resource, id },
              { onSuccess: onDeleted },
            )}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// ShowPage
// ---------------------------------------------------------------------------

export function ShowPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const def = findResource(resources, name);
  const { data, isLoading } = useOne({ resource: name, id });
  const record = (data?.data ?? {}) as any;

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.showFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  const profile = (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]" data-testid={`show-${name}`}>
      {cols.map((c) => (
        <Profilerow key={c.name} label={c.name}>
          {formatCell(record[c.name], c)}
        </Profilerow>
      ))}
      {oneRels.length > 0 && id && (
        <Profilerow label="related">
          <div className="flex flex-wrap gap-2">
            {oneRels.map((rel) => (
              <OneRelationLink
                key={rel.name}
                parentResource={name!}
                parentId={id}
                relation={rel}
                resources={resources}
              />
            ))}
          </div>
        </Profilerow>
      )}
    </dl>
  );

  return (
    <Page
      back={`/${name}`}
      title={def.label}
      actions={id && (
        <Button asChild size="sm" variant="outline">
          <Link to={`/${name}/edit/${id}`}><Pencil />Edit</Link>
        </Button>
      )}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : manyRels.length === 0 || !id ? (
        profile
      ) : (
        <Tabs defaultValue="__profile">
          <TabsList data-testid={`show-tabs-${name}`}>
            <TabsTrigger value="__profile">Profile</TabsTrigger>
            {manyRels.map((rel) => (
              <TabsTrigger key={rel.name} value={rel.name}>
                <RelationTabLabel parentResource={name!} parentId={id} relation={rel} />
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="__profile">{profile}</TabsContent>
          {manyRels.map((rel) => (
            <TabsContent key={rel.name} value={rel.name}>
              <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </Page>
  );
}

function Profilerow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </>
  );
}

function RelationTabLabel({
  parentResource, parentId, relation,
}: { parentResource: string; parentId: string; relation: ResourceRelation }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=0&_end=1`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? Number(r.headers.get('x-total-count') ?? '0') : null))
      .then(setCount)
      .catch(() => setCount(null));
  }, [parentResource, parentId, relation.name]);
  return (
    <span data-testid={`tab-relation-${relation.name}`}>
      {relation.name}{count !== null ? ` (${count})` : ''}
    </span>
  );
}

function RelatedTable({
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
              {rows.map((row, i) => (
                <TableRow key={targetPk ? row[targetPk] : i}>
                  {cols.map((c) => (
                    <TableCell key={c.name}>
                      {targetPk && c.name === targetPk
                        ? <Link to={`/${relation.target}/show/${row[targetPk]}`} className="text-primary hover:underline">{formatCell(row[c.name], c)}</Link>
                        : formatCell(row[c.name], c)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
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

function OneRelationLink({
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

  if (empty) { return <Badge variant="secondary">{relation.name}: <em className="not-italic ml-1 text-muted-foreground">none</em></Badge>; }
  if (!row || !targetDef) { return <Badge variant="secondary">{relation.name}: …</Badge>; }
  const targetPk = singlePk(targetDef);
  if (!targetPk) { return <Badge variant="info">{relation.name}</Badge>; }
  return (
    <Link to={`/${relation.target}/show/${row[targetPk]}`} data-testid={`one-relation-${relation.name}`}>
      <Badge variant="info" className="hover:opacity-90">{relation.name}: {String(row[targetPk])}</Badge>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// EditPage / CreatePage  + form + RelationPicker
// ---------------------------------------------------------------------------

export function EditPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { data, isLoading } = useOne({ resource: name, id });
  const { mutate: update, isLoading: saving } = useUpdate();

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.formFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  return (
    <Page
      back={`/${name}`}
      title={def.label}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : manyRels.length === 0 || !id ? (
        <FormBody
          cols={cols}
          resources={resources}
          oneRelations={oneRels}
          omitPrimary
          initialValues={(data?.data ?? {}) as any}
          saving={saving}
          dataTestId={`edit-${name}`}
          onSubmit={(values) => update({ resource: name!, id: id!, values }, {
            onSuccess: () => navigate(`/${name}`),
          })}
        />
      ) : (
        <Tabs defaultValue="__profile">
          <TabsList data-testid={`edit-tabs-${name}`}>
            <TabsTrigger value="__profile">Profile</TabsTrigger>
            {manyRels.map((rel) => (
              <TabsTrigger key={rel.name} value={rel.name}>
                <RelationTabLabel parentResource={name!} parentId={id} relation={rel} />
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="__profile">
            <FormBody
              cols={cols}
              resources={resources}
              oneRelations={oneRels}
              omitPrimary
              initialValues={(data?.data ?? {}) as any}
              saving={saving}
              dataTestId={`edit-${name}`}
              onSubmit={(values) => update({ resource: name!, id, values }, {
                onSuccess: () => navigate(`/${name}`),
              })}
            />
          </TabsContent>
          {manyRels.map((rel) => (
            <TabsContent key={rel.name} value={rel.name}>
              <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </Page>
  );
}

export function CreatePage({ resources }: { resources: Resource[] }) {
  const { resource: name } = useParams();
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { mutate: create, isLoading: saving } = useCreate();

  if (!def) { return <div>unknown resource</div>; }
  const cols = visibleColumns(def, def.formFields);
  const oneRels = (def.relations ?? []).filter((r) => r.kind === 'one');

  // ?_prefill_<col>=<value> seeds initial values for the form. Used by the
  // "+ New related" button on relation tabs to pass the parent FK.
  const prefill = useMemo(() => {
    const out: Record<string, any> = {};
    if (typeof window === 'undefined') { return out; }
    for (const [k, v] of new URLSearchParams(window.location.search).entries()) {
      if (k.startsWith('_prefill_')) { out[k.slice('_prefill_'.length)] = v; }
    }
    return out;
  }, []);

  return (
    <Page back={`/${name}`} title={`New ${def.label}`}>
      <FormBody
        cols={cols}
        resources={resources}
        oneRelations={oneRels}
        omitDefaulted
        initialValues={prefill}
        saving={saving}
        dataTestId={`create-${name}`}
        onSubmit={(values) => create({ resource: name!, values }, {
          onSuccess: () => navigate(`/${name}`),
        })}
      />
    </Page>
  );
}

interface FormBodyProps {
  cols: Column[];
  resources: Resource[];
  oneRelations: ResourceRelation[];
  omitPrimary?: boolean;
  omitDefaulted?: boolean;
  initialValues: Record<string, any>;
  saving: boolean;
  dataTestId: string;
  onSubmit: (values: Record<string, any>) => void;
}

function FormBody({
  cols, resources, oneRelations, omitPrimary, omitDefaulted, initialValues, saving, dataTestId, onSubmit,
}: FormBodyProps) {
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...initialValues }));
  // Re-seed when initialValues becomes available (e.g. Edit useOne resolves).
  useEffect(() => { setValues({ ...initialValues }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(initialValues)]);
  const fkRelByCol = new Map(oneRelations.map((r) => [r.fk, r]));

  const visible = cols.filter((c) => !(omitPrimary && c.primary) && !(omitDefaulted && c.hasDefault));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, any> = {};
    for (const c of visible) {
      let v = values[c.name];
      if (isJsonish(c) && typeof v === 'string') { v = safeParseJson(v); }
      out[c.name] = v;
    }
    onSubmit(out);
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid={dataTestId}>
      {visible.map((c) => {
        const rel = fkRelByCol.get(c.name);
        // A column is required when (NOT NULL or PK) and no default. PKs
        // are non-null by definition; some drizzle column definitions
        // don't add `.notNull()` to PKs explicitly, so we treat `primary`
        // as implying required when there's no default. Previously a
        // user could create a leaderboard with an empty id, leaving
        // /admin/leaderboards/edit/ unreachable.
        const required = (c.notNull || c.primary) && !c.hasDefault;
        return (
          <div key={c.name} className="space-y-1.5">
            <Label htmlFor={`f-${c.name}`}>
              {c.name}{required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {rel ? (
              <RelationPicker
                target={rel.target}
                resources={resources}
                value={values[c.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [c.name]: v }))}
              />
            ) : isJsonish(c) ? (
              <textarea
                id={`f-${c.name}`}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={typeof values[c.name] === 'string' ? values[c.name] : JSON.stringify(values[c.name] ?? '', null, 0)}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                placeholder='valid JSON, e.g. "value" or {"a":1}'
              />
            ) : isDate(c) ? (
              <Input
                id={`f-${c.name}`}
                type="datetime-local"
                value={values[c.name] ? toLocalDateTime(values[c.name]) : ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                required={required}
              />
            ) : isNumeric(c) ? (
              <Input
                id={`f-${c.name}`}
                type="number"
                value={values[c.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                required={required}
              />
            ) : isBoolean(c) ? (
              <select
                id={`f-${c.name}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={values[c.name] === true ? 'true' : values[c.name] === false ? 'false' : ''}
                onChange={(e) => setValues((prev) => ({
                  ...prev,
                  [c.name]: e.target.value === '' ? null : e.target.value === 'true',
                }))}
              >
                <option value=""></option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <Input
                id={`f-${c.name}`}
                value={values[c.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                required={required}
                name={c.name}
              />
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function toLocalDateTime(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) { return ''; }
  // YYYY-MM-DDTHH:MM in local time
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// RelationPicker — searchable FK select
// ---------------------------------------------------------------------------

function RelationPicker({
  target, resources, value, onChange,
}: {
  target: string; resources: Resource[]; value?: string | number; onChange?: (v: any) => void;
}) {
  const targetDef = findResource(resources, target);
  const targetPk = targetDef ? singlePk(targetDef) : null;
  const labelCol = targetDef ? pickLabelColumn(targetDef) : null;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Array<{ value: any; label: string }>>([]);
  const [labelByValue, setLabelByValue] = useState<Map<any, string>>(new Map());

  const makeOption = (row: any): { value: any; label: string } => {
    const id = targetPk ? row[targetPk] : '';
    const label = labelCol && row[labelCol] != null && row[labelCol] !== ''
      ? `${row[labelCol]} · ${id}`
      : String(id);
    return { value: id, label };
  };

  // Search + initial load via the same _q endpoint we use for the list page.
  useEffect(() => {
    if (!targetDef) { return; }
    const url = `/admin-api/${target}?_start=0&_end=20${q ? `&_q=${encodeURIComponent(q)}` : ''}`;
    fetch(url, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<any[]>) : Promise.resolve([])))
      .then((rows) => {
        const mapped = rows.map(makeOption);
        setOptions(mapped);
        setLabelByValue((prev) => {
          const next = new Map(prev);
          for (const o of mapped) { next.set(o.value, o.label); }
          return next;
        });
      })
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [target, q]);

  // Resolve label for a preset value (Edit / prefill) on first render.
  useEffect(() => {
    if (value == null || value === '' || !targetDef || labelByValue.has(value)) { return; }
    fetch(`/admin-api/${target}/${encodeURIComponent(String(value))}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((row) => {
        if (!row) { return; }
        const o = makeOption(row);
        setLabelByValue((prev) => new Map(prev).set(o.value, o.label));
      })
      .catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [value, target]);

  if (!targetDef) {
    return <Input value={(value as any) ?? ''} onChange={(e) => onChange?.(e.target.value)} />;
  }

  const currentLabel = value != null && value !== ''
    ? labelByValue.get(value) ?? String(value)
    : null;

  return (
    <span data-testid={`relation-picker-${target}`} className="block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !currentLabel && 'text-muted-foreground')}>
              {currentLabel ?? `Select ${targetDef.label.toLowerCase()}…`}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={String(o.value)}
                    value={String(o.value)}
                    onSelect={() => { onChange?.(o.value); setOpen(false); }}
                  >
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </span>
  );
}
