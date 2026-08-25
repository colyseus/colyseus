/**
 * Per-column filter dropdowns. Triggered from the column header; each
 * column type maps to its own picker (text/like, boolean, number range,
 * date range). All filters round-trip through refine's filter array
 * via `replaceColumnFilters` — keyed by `<col>` or `<col>_<op>`.
 */
import { useState } from 'react';
import { Filter as FilterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { type Column, isBoolean, isDate, isNumeric } from '../../types';
import { cn } from '@/lib/utils';

export type SetFilters = (filters: any[], behavior?: 'merge' | 'replace') => void;

export function replaceColumnFilters(
  setFilters: SetFilters, filters: any[] | undefined, field: string, next: any[],
) {
  const others = (filters ?? []).filter((f: any) => {
    return !(f.field === field || (typeof f.field === 'string' && f.field.startsWith(`${field}_`)));
  });
  setFilters([...others, ...next], 'replace');
}

export function ColumnFilter({ c, filters, setFilters, active }: {
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
