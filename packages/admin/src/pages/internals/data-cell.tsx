/**
 * `<TableCell>` wrapper that wires row-level click navigation while
 * staying out of the way of cells that render their own anchor
 * (FK columns with `linkTo` — `formatCell` already wraps those in a
 * `<Link>`, and nesting a row click around an inner anchor lets the
 * inner anchor's navigation win for that cell only). Used by the
 * standalone list page and the related-tabs table on the user-show
 * page, both of which want clicking anywhere on a row to drill into
 * the row's show / nested-show URL.
 */
import * as React from 'react';
import { TableCell } from '@/components/ui/table';
import type { Column } from '../../types';
import { cn } from '@/lib/utils';

export interface DataCellProps {
  column: Column;
  /** Row-level navigation handler. Omit to render a static cell. */
  onNavigate?: () => void;
  /** Extra classes — merged with `cursor-pointer` when interactive. */
  className?: string;
  children: React.ReactNode;
}

export function DataCell({ column, onNavigate, className, children }: DataCellProps) {
  // FK cells emit their own `<Link>` — defer to that. The row's other
  // cells stay click-routable so the operator can hit the row from
  // a non-FK column (often the more natural target).
  const interactive = !!onNavigate && !column.linkTo;
  return (
    <TableCell
      className={cn(className, interactive && 'cursor-pointer')}
      onClick={interactive ? onNavigate : undefined}
    >
      {children}
    </TableCell>
  );
}
