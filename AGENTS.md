# Project Instructions

## Testing

- Run `npm test -- --grep 'NAME OF TEST CASE'` from `bundles/colyseus` directory.
  - Before running tests, must use `pnpm build` at root of monorepo if any of the child packages have changes.
- When making changes to `@colyseus/sdk`, make sure to run `npx tsc` from `./packages/sdk` to update TypeScript definitions.