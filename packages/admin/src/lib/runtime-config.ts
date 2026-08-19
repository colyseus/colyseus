/**
 * Mount-aware runtime coordinates for the prebuilt SPA.
 *
 * The backend injects `window.__COLYSEUS_ADMIN__` (plus a matching
 * `<base href>`) into index.html at serve time, so one prebuilt bundle
 * works at the root, under any express path mount, or behind a
 * reverse-proxy sub-path. The fallbacks keep `vite dev` (no backend
 * injection) on the default root-mount paths.
 */
interface RuntimeConfig {
  /** External UI base, with trailing slash (e.g. `/admin/`, `/x/`). */
  base: string;
  /** External REST base, no trailing slash (e.g. `/admin-api`). */
  api: string;
}

const cfg: RuntimeConfig =
  (typeof window !== 'undefined' && (window as any).__COLYSEUS_ADMIN__) ||
  { base: '/admin/', api: '/admin-api' };

/** External UI base, with trailing slash. Use for hard navigations to the panel root. */
export const UI_BASE = cfg.base;

/** React Router basename — UI_BASE without the trailing slash. */
export const BASENAME = UI_BASE.replace(/\/$/, '');

/** External REST API base, no trailing slash. */
export const API = cfg.api;
