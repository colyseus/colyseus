import type { Column, Resource } from '../../types';

export function findResource(resources: Resource[], name?: string): Resource | undefined {
  return resources.find((r) => r.name === name);
}

export function visibleColumns(def: Resource, subset: string[] | undefined): Column[] {
  if (!subset || subset.length === 0) { return def.columns; }
  const order = new Map(subset.map((n, i) => [n, i]));
  return def.columns
    .filter((c) => order.has(c.name))
    .sort((a, b) => order.get(a.name)! - order.get(b.name)!);
}

/** Best-effort label column for a resource, used by RelationPicker. */
export function pickLabelColumn(def: Resource): string | null {
  const colNames = def.columns.map((c) => c.name);
  for (const candidate of ['display_name', 'name', 'email', 'title']) {
    if (colNames.includes(candidate)) { return candidate; }
  }
  const firstText = def.columns.find((c) =>
    !c.primary && (c.dataType === 'string' || /^(text|varchar|char)/i.test(c.type)),
  );
  return firstText?.name ?? null;
}
