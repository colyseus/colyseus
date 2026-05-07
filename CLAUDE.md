# Project conventions for Claude

## Erasable syntax only

All TypeScript in this repo must be **erasable** — that is, the source must
remain valid JavaScript after the type annotations are stripped, with no
runtime emit beyond what the JS spec already produces. This makes the code
runnable directly under Node ≥ 22's `--experimental-strip-types` and any
other type-stripping toolchain (esbuild's `transform`, Bun, Deno, etc.) with
no surprises.

In practice that means:

- **No constructor parameter properties.** This is the most common
  violation. Write the field explicitly and assign in the body.

  ```ts
  // ❌ not erasable — `private db` here is a TS-emit feature
  class Foo {
    constructor(private db: DB) {}
  }

  // ✅ erasable
  class Foo {
    private db: DB;
    constructor(db: DB) {
      this.db = db;
    }
  }
  ```

- **No `enum`.** Use `const` objects or string literal unions.

  ```ts
  // ❌
  enum Role { Admin = 'admin', Mod = 'mod' }

  // ✅
  type Role = 'admin' | 'mod';
  const Role = { Admin: 'admin', Mod: 'mod' } as const;
  ```

- **No `namespace { ... }` with code.** Type-only `declare namespace` is fine.

- **No `import =` / `export =`.** Use ESM `import` / `export`.

- **Method-level modifiers (`public`, `private`, `protected`) on class members
  ARE erasable** and fine to use. Only the constructor-parameter shorthand
  is the problem.

If you need a quick local check, run the file under `node --experimental-strip-types`.
The transform throws a `SyntaxError` on the offending construct.

## Testing

(see AGENTS.md for the existing testing conventions)
