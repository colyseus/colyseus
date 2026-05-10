/**
 * Wire-format types for the resource catalog (`GET /admin-api`). These are
 * the single source of truth shared between the backend (which builds the
 * payload in `catalog.ts`) and the frontend (which consumes it via
 * `src/types.ts`'s re-exports).
 *
 * Anything here is part of the public contract:
 *   - Adding a required field is a breaking change for custom frontends.
 *   - Adding an optional field is safe (older clients ignore it).
 *
 * External consumers can import these via `@colyseus/admin/catalog-types`
 * (the package's `./*` subpath export resolves to the built .d.ts).
 */

export interface CatalogColumn {
  /** SQL column name (machine identifier — stable, used in URLs / form bindings). */
  name: string;
  /** Human-friendly label for table headers, form fields, and dt rows.
   *  Default: `humanize(name)`. Renderers should prefer this over `name`. */
  label: string;
  /**
   * Set when this column is a single-column foreign key to another registered
   * resource. The list page renders such cells as a `<Link>` to the target's
   * detail page, and substitutes the target's label-column value when
   * available (fetched in one batched request via the `_in` filter).
   *
   * `pkColumn` is the target's single-PK column name (used to filter and to
   * key the label map). `labelColumn` is `null` when the target has no
   * obvious label column — cells then show the raw FK value but stay linked.
   *
   * Composite-PK targets are not eligible (FK is single-column by design).
   */
  linkTo?: {
    resource: string;
    pkColumn: string;
    labelColumn: string | null;
  };
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
  /** True when the column has a SQL default OR drizzle $defaultFn. */
  hasDefault: boolean;
}

export interface CatalogResourceAction {
  name: string;
  label: string;
  perRow: boolean;
  /** Show a confirmation prompt before invoking. */
  confirm?: { title?: string; description?: string };
}

/** Foreign-key relation to another resource — shown as a tab or badge on the detail page. */
export interface CatalogResourceRelation {
  /** Machine identifier — stable, used in URLs and testids. */
  name: string;
  /** Human-friendly label for tab + badge text. Default: `humanize(name)`. */
  label: string;
  /** Canonical name of the target resource. */
  target: string;
  /** `'many'` → tab with a paginated table. `'one'` → clickable badge. */
  kind: 'one' | 'many';
  /** SQL column name of the FK on the owning side — used to pre-fill on "New related" forms. */
  fk: string;
}

export interface CatalogResource {
  name: string;
  label: string;
  /** Lucide icon id; always present (server resolves a default per table name). */
  icon: string;
  columns: CatalogColumn[];
  /**
   * PK column names. One entry for single-PK tables; multiple for composite-PK
   * tables (rendered with the base64url-of-JSON-tuple id codec).
   */
  primaryKey: string[];
  /** ResourceDefinition.list.columns override — renderer falls back to all columns. */
  listColumns?: string[];
  /** ResourceDefinition.form.fields override — renderer falls back to all columns. */
  formFields?: string[];
  /** ResourceDefinition.show.fields override — renderer falls back to all columns. */
  showFields?: string[];
  actions: CatalogResourceAction[];
  relations: CatalogResourceRelation[];
}
