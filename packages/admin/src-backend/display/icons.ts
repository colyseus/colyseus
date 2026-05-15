/**
 * Canonical list of icon names the admin panel knows how to render.
 *
 * The frontend (`src/icons.tsx`) maps each of these to a lucide-react
 * component; the backend uses it to constrain `icon?:` fields on resources
 * and dashboard widgets so typos surface at compile time rather than as a
 * silent fallback to the Database glyph at render time.
 *
 * Add a new icon by:
 *   1. extending this array with its kebab-case name, and
 *   2. adding the matching entry in `src/icons.tsx`'s MAP.
 * The `Record<AdminIconName, LucideIcon>` assertion on the frontend MAP
 * keeps the two sides in lockstep — forgetting step 2 fails the build.
 */
export const ADMIN_ICON_NAMES = [
  'user', 'user-add', 'team', 'shopping', 'shopping-cart', 'appstore',
  'trophy', 'cloud', 'save', 'setting', 'calendar', 'clock-circle',
  'line-chart', 'bar-chart', 'pie-chart', 'dashboard', 'heart', 'cluster',
  'file-text', 'safety', 'key', 'message', 'bell', 'credit-card', 'flag',
  'gift', 'smile', 'environment', 'build', 'thunderbolt', 'stop',
  'warning', 'skin', 'node-index', 'database', 'radio',
] as const;

export type AdminIconName = (typeof ADMIN_ICON_NAMES)[number];
