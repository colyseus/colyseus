/**
 * Searchable foreign-key picker. Used by FormBody for any column that
 * is the FK of a one-relation. Hits `/admin-api/<target>?_q=...` for
 * search, falls back to a single GET to resolve the label of a preset
 * value (Edit / `?_prefill_*`).
 */
import { useEffect, useState } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { type Resource, singlePk } from '../../types';
import { findResource, pickLabelColumn } from './helpers';
import { cn } from '@/lib/utils';
import { API } from '@/lib/runtime-config';

export function RelationPicker({
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
    const url = `${API}/${target}?_start=0&_end=20${q ? `&_q=${encodeURIComponent(q)}` : ''}`;
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
    fetch(`${API}/${target}/${encodeURIComponent(String(value))}`, { credentials: 'include' })
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
