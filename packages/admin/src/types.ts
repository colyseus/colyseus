export interface Column {
  name: string;
  type: string;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
}

export interface ResourceAction {
  name: string;
  label: string;
  perRow: boolean;
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
}

/** Single-PK tables get edit/show/delete actions; composite-PK tables are list-only. */
export function singlePk(r: Resource): string | null {
  return r.primaryKey.length === 1 ? r.primaryKey[0]! : null;
}

export function isJsonish(c: Column): boolean {
  return c.type === 'jsonb' || c.type === 'json';
}

export function isNumeric(c: Column): boolean {
  return ['integer', 'serial', 'bigint', 'numeric', 'double precision', 'real'].includes(c.type);
}

export function isDate(c: Column): boolean {
  return c.type === 'timestamp' || c.type === 'date' || c.type === 'timestamp with time zone';
}
