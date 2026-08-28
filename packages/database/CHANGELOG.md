# Changelog

## 0.18.2

- `migrations: "auto"` now applies the `UNIQUE` and `CHECK` constraints declared on a custom table, and creates its `index()` / `uniqueIndex()` definitions on every boot. They were previously ignored without an error, so a constraint you declared never existed in the database.
- The `tables.sqlite.*` / `tables.pg.*` factories accept a third argument for indexes and constraints, mirroring drizzle's own `sqliteTable()` / `pgTable()`:

```ts
const users = tables.sqlite.users("colyseus_users", {
    handle: text("handle"),
    handleLower: text("handle_lower"),
}, (t) => [
    uniqueIndex("users_handle_lower_idx").on(t.handleLower),
    check("users_handle_lower_chk", sql`${t.handleLower} = lower(${t.handle})`),
]);
```
