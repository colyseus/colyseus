/**
 * Pure builder for the resource catalog. The endpoint
 * (`endpoints/catalog.ts`) is just `return json(buildResourceCatalog(ctx))`
 * — keeping the construction here means we can unit-test it without a
 * Request/Response round-trip.
 */
import type { GameDatabase } from '@colyseus/database';
import { resolveFkLayout } from '@colyseus/database';
import type { ResourceDefinition } from './define-resource.js';
import { iconForTableName } from './default-icons.js';
import type { TableColumn, TableConfig } from './helpers.js';
import { humanize } from './humanize.js';
import type { CatalogColumn, CatalogResource } from './catalog-types.js';

export interface BuildCatalogInput {
  tables: Record<string, any>;
  resources: Record<string, ResourceDefinition>;
  getTableConfig: (table: any) => TableConfig;
  /** Pre-resolved relation metadata, normally `database.relations`. */
  relations: GameDatabase['relations'];
}

/** Per-resource bits used to populate FK link metadata for cells on OTHER resources. */
interface ResourceMeta {
  cfg: TableConfig;
  /** Single-column PK SQL name, or null when the table has a composite PK. */
  pkColumn: string | null;
  /** Best-guess display column SQL name, or null when nothing reasonable matched. */
  labelColumn: string | null;
}

export function buildResourceCatalog(input: BuildCatalogInput): CatalogResource[] {
  const { tables, resources, getTableConfig, relations } = input;

  // Pre-pass: per-resource metadata that other resources need to populate
  // their `linkTo` fields. Doing it once keeps the main loop O(N) over
  // tables × columns and avoids re-walking targets on every FK column.
  const meta = new Map<string, ResourceMeta>();
  for (const [name, t] of Object.entries(tables)) {
    const cfg = getTableConfig(t);
    const pks = cfg.columns.filter((c) => c.primary);
    meta.set(name, {
      cfg,
      pkColumn: pks.length === 1 ? pks[0]!.name : null,
      labelColumn: pickLabelColumn(cfg.columns),
    });
  }

  return Object.entries(tables).map(([name, t]) => {
    const cfg = meta.get(name)!.cfg;
    const def = resources[name];
    const compositePk = (cfg.primaryKeys ?? []).flatMap((pk) =>
      pk.columns.map((c) => c.name));
    const singlePk = cfg.columns.filter((c) => c.primary).map((c) => c.name);

    // Source-of-truth for FK columns on THIS table: every 'one' relation
    // declared FROM this resource whose FK column actually lives on the
    // source side maps to a `linkTo` on the corresponding column. Built
    // from the runtime relation metadata (built-ins + user overrides) so
    // custom relations surface link decoration automatically.
    const sourceTable = tables[name];
    const linkToBySqlName = new Map<string, CatalogColumn['linkTo']>();
    for (const r of relations[name] ?? []) {
      if (r.kind !== 'one') { continue; }
      const targetTable = tables[r.target];
      if (!targetTable) { continue; }
      const layout = resolveFkLayout(sourceTable, targetTable, r.fk);
      if (!layout || layout.fkOn !== 'source') { continue; }
      const targetMeta = meta.get(r.target);
      // Composite-PK targets aren't reachable via a single-column FK; skip.
      if (!targetMeta || !targetMeta.pkColumn) { continue; }
      const fkSqlName = (layout.fkCol as { name?: string }).name;
      if (!fkSqlName) { continue; }
      // First-declared wins if the same column happens to be the FK of
      // multiple one-relations (rare; `name` collisions would already be
      // user error).
      if (!linkToBySqlName.has(fkSqlName)) {
        linkToBySqlName.set(fkSqlName, {
          resource: r.target,
          pkColumn: targetMeta.pkColumn,
          labelColumn: targetMeta.labelColumn,
        });
      }
    }

    const sourceRelations = (relations[name] ?? [])
      .filter((r) => !!tables[r.target])
      .map((r) => {
        // The runtime `fk` is the drizzle JS field name (e.g. `userId`).
        // For `many` relations the FK column lives on the target table
        // (target.userId → source.id); for `one` relations it lives on
        // the source (source.userId → target.id). Look up on the correct
        // side and emit the SQL column name so the frontend's form
        // fields (which use SQL names) can match.
        const ownerTable = r.kind === 'one' ? sourceTable : tables[r.target];
        const col = ownerTable ? (ownerTable as any)[r.fk] : null;
        const fkSql = (col && (col as any).name) ?? r.fk;
        return {
          name: r.name,
          label: def?.relations?.[r.name]?.label ?? humanize(r.name),
          target: r.target,
          kind: r.kind,
          fk: fkSql,
        };
      });
    return {
      name,
      label: def?.label ?? humanize(name),
      icon: def?.icon ?? iconForTableName(cfg.name),
      columns: cfg.columns.map((c) => {
        const linkTo = linkToBySqlName.get(c.name);
        return {
          name: c.name,
          label: def?.columns?.[c.name]?.label ?? humanize(c.name),
          ...(linkTo ? { linkTo } : {}),
          type: typeof c.getSQLType === 'function' ? c.getSQLType() : 'text',
          // dataType is the JS-side category ('date', 'json', 'number',
          // 'string', 'boolean'). Distinguishes timestamp-mode integers
          // from regular integers — `c.getSQLType()` would return
          // 'integer' for both.
          dataType: c.dataType ?? null,
          notNull: c.notNull,
          primary: c.primary,
          // Treat any of {SQL default, $defaultFn, autoIncrement, serial} as
          // "the DB will fill this in" — that's what the Create form reads
          // to decide whether to hide the field. Drizzle 1.0 already sets
          // hasDefault for autoIncrement integers + pg serial, but checking
          // c.autoIncrement directly hardens us against schema variants
          // (custom column types, future drizzle changes) where the flag
          // might not propagate.
          hasDefault: !!c.hasDefault || !!c.defaultFn || !!c.autoIncrement,
        };
      }),
      primaryKey: singlePk.length ? singlePk : compositePk,
      listColumns: def?.list?.columns,
      formFields: def?.form?.fields,
      showFields: def?.show?.fields,
      actions: (def?.actions ?? []).map((a) => ({
        name: a.name,
        label: a.label ?? a.name,
        perRow: !!a.perRow,
        confirm: a.confirm,
      })),
      relations: sourceRelations,
    };
  });
}

/**
 * Pick a column from `columns` to display when linking to a row of this table.
 * Mirrors the frontend's heuristic so FK cells show a meaningful label
 * (e.g. user.display_name) instead of the raw FK value. Returns null when
 * nothing reasonable matched — cells then show the raw value but stay
 * linked.
 */
function pickLabelColumn(columns: ReadonlyArray<TableColumn>): string | null {
  const names = columns.map((c) => c.name);
  for (const candidate of ['display_name', 'name', 'email', 'title']) {
    if (names.includes(candidate)) { return candidate; }
  }
  // Fallback: first non-primary text-typed column.
  const firstText = columns.find((c) => {
    if (c.primary) { return false; }
    const t = typeof c.getSQLType === 'function' ? c.getSQLType() : '';
    return /^(text|varchar|char)/i.test(t);
  });
  return firstText?.name ?? null;
}
