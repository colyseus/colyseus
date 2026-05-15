import type { Action, Role } from '@colyseus/database';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ResourceTypeDeps = Action | Role;

export interface ResourceAction {
  /** action name (URL: POST /admin-api/:resource/_action/:name) */
  name: string;
  /** display label; defaults to name */
  label?: string;
  /**
   * Handler — receives the row (when called per-row) and a context with userId.
   * Return value is JSON-serialized and sent back to the client.
   */
  handler: (
    row: any,
    ctx: { userId: string; resource: string },
  ) => Promise<unknown> | unknown;
  /** Restrict to roles; admin always has access via the default policy. */
  roles?: Role[];
  /** If true, requires a row id; UI shows it as a row-level action. */
  perRow?: boolean;
  /**
   * If set, the UI prompts before invoking the action. Use for destructive
   * or expensive operations (refunds, bans, item revokes).
   */
  confirm?: {
    /** Popconfirm title — defaults to `Run "<label>"?`. */
    title?: string;
    /** Optional supporting copy shown below the title. */
    description?: string;
  };
}

export type PolicyEntry =
  | Role[]
  | 'everyone'
  | 'deny';

/**
 * Per-column UX override. Today the only field is `label`; the shape is
 * an object so future per-column tweaks (formatter, hidden flag, etc.)
 * land additively without re-doing the API.
 */
export interface ColumnOverride {
  /** Override the default humanized header/profile/form label. */
  label?: string;
  /**
   * Decorate this column with a link to another resource's show page.
   * Two flavors:
   *   - Static: `{ resource: 'users' }` — every cell value is treated
   *     as the FK to the same target.
   *   - Dynamic: `{ resourceFromColumn: 'resource' }` — the renderer
   *     reads the row's value at that sibling column to pick the target.
   *     Used by the audit log where `target_id` references many tables.
   *
   * Static FK columns derived from `database.relations` auto-emit a
   * linkTo via the catalog and don't need this override.
   */
  linkTo?: {
    resource?: string;
    resourceFromColumn?: string;
  };
}

/**
 * Per-relation UX override. Same future-proofing rationale as
 * `ColumnOverride`.
 */
export interface RelationOverride {
  /** Override the default humanized tab + badge label. */
  label?: string;
}

/**
 * Context passed to `create.defaults(...)`. Stays narrow on purpose —
 * adding fields here is non-breaking, but every field we add lives
 * forever, so we only surface what's load-bearing.
 */
export interface CreateDefaultsContext {
  /**
   * The signed-in admin's userId. Undefined only when RBAC is
   * disabled (dev mode) AND the request didn't carry a session.
   * Treat as optional in your default function.
   */
  operatorId: string | undefined;
  /** Drizzle table name being created — useful for shared default factories. */
  resource: string;
}

export interface ResourceDefinition {
  /** drizzle table name (auto-extracted) */
  __tableName: string;
  /** human label for sidebar/page titles */
  label?: string;
  /** AntD icon name (e.g. "team", "trophy") for the sidebar */
  icon?: string;
  list?: {
    /** columns to show in the list view; if omitted, all columns are shown */
    columns?: string[];
    /** marker — sortable columns */
    sortable?: string[];
    /**
     * Default ORDER BY applied when the request didn't pass `_sort` /
     * `_order`. Useful for append-only tables (audit log, notes) where
     * insertion order ≠ meaningful order — the random-nanoid PK makes
     * the natural ordering arbitrary, so a sensible default is needed.
     * The user can still override by clicking a column header.
     */
    defaultSort?: { field: string; order: 'asc' | 'desc' };
  };
  form?: {
    /** fields to show in create+edit forms; if omitted, all non-defaulted columns */
    fields?: string[];
  };
  create?: {
    /**
     * Server-side defaults merged into the body before INSERT. The function
     * runs on every create request with the resolved operator (the signed-in
     * admin's userId) in scope, so it can fill columns like `authorId`,
     * `createdBy`, or any audit-style field from the session. The user's
     * request body wins — defaults only fill keys the request didn't set,
     * matching how SQL DEFAULTs behave column-by-column.
     *
     * Keys can be either SQL column names (`'author_id'`) or drizzle JS
     * keys (`'authorId'`); the same body-translator the request body
     * goes through normalizes both forms.
     *
     *   create: {
     *     defaults: ({ operatorId }) => ({ authorId: operatorId }),
     *   }
     */
    defaults?: (ctx: CreateDefaultsContext) => Record<string, any> | Promise<Record<string, any>>;
  };
  show?: {
    /** fields to show on the show page; defaults to all */
    fields?: string[];
  };
  /**
   * Per-column overrides keyed by SQL column name. Most fields fall back
   * to defaults (label → humanize(name)); only set what you want to change.
   *
   *   columns: { created_at: { label: 'Joined' } }
   */
  columns?: Record<string, ColumnOverride>;
  /**
   * Per-relation overrides keyed by relation name (the same name used in
   * RelationDefinition / `database.relations`).
   *
   *   relations: { cloudSaves: { label: 'Saves' } }
   */
  relations?: Record<string, RelationOverride>;
  actions?: ResourceAction[];
  /**
   * Per-action RBAC override. If set for an action, replaces the default
   * moderation.can() rule.
   *  - `["admin"]`         → only admin
   *  - `["admin", "mod"]`  → admin or any mod (regardless of assignment)
   *  - `"everyone"`        → no auth required
   *  - `"deny"`            → blocked entirely
   */
  policies?: Partial<Record<Action, PolicyEntry>>;
}

const tableNameSymbol = Symbol.for('drizzle:Name');

/**
 * Define UI/UX overrides for a drizzle table in the admin panel.
 * Pass the result into `admin({ resources: { ... } })`.
 *
 * @example
 * ```ts
 * import { defineAdminResource } from '@colyseus/admin';
 * import { guilds } from './schema.ts';
 *
 * export const guildResource = defineAdminResource(guilds, {
 *   label: "Guilds",
 *   list: { columns: ["name", "ownerId"] },
 *   actions: [{
 *     name: "rename", label: "Rename", perRow: true,
 *     handler: async (row, { userId }) => { ... },
 *     roles: ["admin", "mod"],
 *   }],
 *   policies: { delete: ["admin"] },
 * });
 * ```
 */
export function defineAdminResource(
  table: any,
  config: Omit<ResourceDefinition, '__tableName'>,
): ResourceDefinition {
  const name = table?.[tableNameSymbol] ?? table?._?.name;
  if (!name || typeof name !== 'string') {
    throw new Error('[defineAdminResource] table must be a drizzle pgTable or sqliteTable');
  }
  return { __tableName: name, ...config };
}
