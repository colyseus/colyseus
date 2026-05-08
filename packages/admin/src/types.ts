export interface Column {
  name: string;
  /** Dialect SQL type (e.g. "integer", "text", "varchar(255)"). */
  type: string;
  /**
   * JS-side category drizzle reports for this column ('date', 'json',
   * 'number', 'string', 'boolean'). Use this for renderer routing — it
   * distinguishes timestamp-mode integers from regular integers, which
   * `type` alone cannot.
   */
  dataType?: string | null;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
}

export interface ResourceAction {
  name: string;
  label: string;
  perRow: boolean;
  /** Show a confirmation prompt before invoking. */
  confirm?: { title?: string; description?: string };
}

/** Foreign-key relation to another resource — shown as a tab or badge on the detail page. */
export interface ResourceRelation {
  /** Display name + URL slug for the relation endpoint. */
  name: string;
  /** Canonical name of the target resource. */
  target: string;
  /** `'many'` → tab with a paginated table. `'one'` → clickable badge. */
  kind: 'one' | 'many';
  /** FK column on the target — used to pre-fill on "New related" forms. */
  fk: string;
}

export interface Resource {
  name: string;
  label: string;
  icon?: string;
  columns: Column[];
  primaryKey: string[];
  listColumns?: string[];
  formFields?: string[];
  showFields?: string[];
  actions: ResourceAction[];
  relations: ResourceRelation[];
}

/** Single-PK tables get edit/show/delete actions; composite-PK tables are list-only. */
export function singlePk(r: Resource): string | null {
  return r.primaryKey.length === 1 ? r.primaryKey[0]! : null;
}

/**
 * Drizzle 1.0 emits `dataType` as space-separated tokens for some column
 * shapes — `"object date"` for `integer({ mode: 'timestamp' })`,
 * `"number int53"` for plain integers, etc. Match any token rather than
 * the whole string so renderers don't fall through to "unknown".
 */
function hasDataType(c: Column, kind: string): boolean {
  if (!c.dataType) { return false; }
  return c.dataType.split(/\s+/).includes(kind);
}

export function isJsonish(c: Column): boolean {
  if (hasDataType(c, 'json')) { return true; }
  return c.type === 'jsonb' || c.type === 'json';
}

export function isNumeric(c: Column): boolean {
  if (hasDataType(c, 'number') || hasDataType(c, 'bigint')) { return true; }
  return ['integer', 'serial', 'bigint', 'numeric', 'double precision', 'real'].includes(c.type);
}

export function isDate(c: Column): boolean {
  // dataType is authoritative — sqlite stores timestamp-mode as `integer` SQL
  // type but drizzle reports dataType containing 'date'. Without this we'd
  // render created_at as a raw unix epoch number.
  if (hasDataType(c, 'date')) { return true; }
  return c.type === 'timestamp' || c.type === 'date' || c.type === 'timestamp with time zone';
}

export function isBoolean(c: Column): boolean {
  if (hasDataType(c, 'boolean')) { return true; }
  return c.type === 'boolean';
}
