/**
 * useFkLabels — turn raw FK values in a table page into human labels.
 *
 * Query budget: ONE batched fetch per FK column per render, regardless of
 * how many rows are on the page. Collects every distinct non-null FK value,
 * fires `?<pkColumn>_in=v1,v2,...&_end=N` against the target resource, and
 * builds a `value → label` map keyed by column name.
 *
 * Composes with `formatCell(value, column, linkLabel?)` — the list page
 * passes `labels.get(c.name)?.get(value)` as the third arg, so cells render
 * the label when known and fall back to the raw value while in flight.
 *
 * Cancellation: a `cancelled` latch in the effect closure prevents stale
 * fetch results (e.g. from page-2 → page-3 navigation) from clobbering
 * fresh state. State is per-component-mount so unmounting drops everything.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Column, Resource } from '../../types';
import { API } from '@/lib/runtime-config';

export type FkLabelMaps = Map<string, Map<unknown, string>>;

export function useFkLabels(rows: any[], def: Resource | undefined): FkLabelMaps {
  const [labels, setLabels] = useState<FkLabelMaps>(() => new Map());

  // Stable list of FK columns for this resource.
  const fkCols: Column[] = useMemo(
    () => (def?.columns ?? []).filter((c) => !!c.linkTo),
    [def?.columns],
  );

  useEffect(() => {
    if (!fkCols.length || rows.length === 0) {
      // Reset to empty so a column-config change doesn't leak stale labels.
      setLabels(new Map());
      return;
    }

    let cancelled = false;

    // Collect distinct non-null/-undefined values per FK column, then issue
    // one fetch per column in parallel.
    const fetches = fkCols.map(async (c): Promise<[string, Map<unknown, string>]> => {
      const linkTo = c.linkTo!;
      const values = [...new Set(
        rows
          .map((r) => r[c.name])
          .filter((v) => v !== null && v !== undefined && v !== ''),
      )];
      const empty = new Map<unknown, string>();
      if (values.length === 0) { return [c.name, empty]; }

      // _end >= unique count so we get one row per id back.
      const url = `${API}/${encodeURIComponent(linkTo.resource)}` +
        `?${encodeURIComponent(linkTo.pkColumn)}_in=${values.map((v) => encodeURIComponent(String(v))).join(',')}` +
        `&_end=${values.length}`;
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) { return [c.name, empty]; }
        const targetRows = await res.json() as Array<Record<string, any>>;
        const map = new Map<unknown, string>();
        for (const tr of targetRows) {
          const key = tr[linkTo.pkColumn];
          if (key === null || key === undefined) { continue; }
          // Use the label column when present + non-empty; otherwise leave
          // the entry out so the cell falls back to the raw FK value.
          const label = linkTo.labelColumn != null ? tr[linkTo.labelColumn] : null;
          if (label === null || label === undefined || label === '') { continue; }
          map.set(key, String(label));
        }
        return [c.name, map];
      } catch {
        return [c.name, empty];
      }
    });

    Promise.all(fetches).then((entries) => {
      if (cancelled) { return; }
      setLabels(new Map(entries));
    });

    return () => { cancelled = true; };
    // Tracking row identity matters more than row contents — refetch when
    // the set of FK values *could* have changed. Stringify the projected
    // FK values so we don't hammer this on unrelated re-renders.
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [fkCols, fkValuesKey(rows, fkCols)]);

  return labels;
}

/**
 * Cheap dependency key — hashes the per-FK-column values seen in `rows`
 * so the effect re-runs only when those values actually change. Avoids
 * refetching when an unrelated column on the page updates (e.g. an inline
 * status badge animating).
 */
function fkValuesKey(rows: any[], fkCols: Column[]): string {
  return fkCols
    .map((c) => c.name + ':' + rows.map((r) => r[c.name] ?? '').join(','))
    .join('|');
}
