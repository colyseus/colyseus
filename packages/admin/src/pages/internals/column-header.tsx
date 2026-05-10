import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { type Column, isJsonish } from '../../types';
import { ColumnFilter } from './filters';

export function ColumnHeader({
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
        <span>{c.label}</span>
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
