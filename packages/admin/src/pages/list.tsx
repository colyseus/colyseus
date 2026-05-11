import { useTable } from '@refinedev/core';
import { Link, useParams } from 'react-router-dom';
import { Eye, Loader2, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { type Resource, singlePk, rowId } from '../types';
import { findResource, visibleColumns } from './internals/helpers';
import { formatCell } from './internals/format-cell';
import { SearchInput } from './internals/search';
import { Pagination } from './internals/pagination';
import { ColumnHeader } from './internals/column-header';
import { ActionButton, DeleteRowButton } from './internals/actions';
import { useFkLabels } from './internals/use-fk-labels';
import { cn } from '@/lib/utils';

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

  // FK label lookup — one batched fetch per FK column per page render.
  // Cells render the raw FK first and re-render once labels arrive.
  const fkLabels = useFkLabels(rows, def);

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
                  // w-[1%] + whitespace-nowrap: classic table trick to make
                  // each column shrink to its content width while the table
                  // itself stays w-full. Without this, browsers distribute
                  // leftover container width across columns and a 2-column
                  // table gets weirdly stretched (Id "gRpl_..." floating
                  // alone at the left of a half-empty cell).
                  <TableHead key={c.name} className="w-[1%] whitespace-nowrap">
                    <ColumnHeader
                      column={c}
                      sorters={sorters}
                      setSorters={setSorters}
                      filters={filters}
                      setFilters={setFilters}
                    />
                  </TableHead>
                ))}
                {def.primaryKey.length > 0 && (
                  <TableHead
                    className={cn(
                      'w-[1%] whitespace-nowrap text-right',
                      // Sticky to the right edge so it stays visible when the
                      // table overflows horizontally. Solid bg-background +
                      // border-l mask scrolling content underneath.
                      'sticky right-0 z-20 bg-background border-l shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.05)]',
                    )}
                  >
                    actions
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                // rowId() handles single-PK (bare value) and composite-PK
                // (base64url JSON tuple) shapes uniformly.
                const id = rowId(def, row);
                return (
                  <TableRow
                    key={id ?? i}
                    data-testid={id ? `row-${id}` : undefined}
                    data-row-id={id ?? undefined}
                  >
                    {cols.map((c) => (
                      // Match the header — w-[1%] + whitespace-nowrap shrinks
                      // each cell to its content. formatCell already truncates
                      // long opaque ids and JSON blobs, so nothing legitimate
                      // wants to wrap inside a cell.
                      <TableCell key={c.name} className="w-[1%] whitespace-nowrap">
                        {formatCell(row[c.name], c, fkLabels.get(c.name)?.get(row[c.name]))}
                      </TableCell>
                    ))}
                    {id && (
                      <TableCell
                        className={cn(
                          'text-right',
                          'sticky right-0 z-10 bg-background group-hover:bg-muted/40 border-l shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.05)]',
                        )}
                      >
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="icon">
                            <Link to={`/${resourceName}/show/${id}`} aria-label="view">
                              <Eye />
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="icon">
                            <Link to={`/${resourceName}/edit/${id}`} aria-label="edit">
                              <Pencil />
                            </Link>
                          </Button>
                          <DeleteRowButton
                            resource={resourceName!}
                            id={id}
                            onDeleted={() => tableQuery?.refetch()}
                          />
                          {rowActions.map((a) => (
                            <ActionButton
                              key={a.name}
                              resource={resourceName!}
                              action={a}
                              rowId={id}
                              onComplete={() => tableQuery?.refetch()}
                            />
                          ))}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
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
