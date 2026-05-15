/**
 * Convert a programmatic table/resource name into a human-readable label.
 *
 *   users              → "Users"
 *   cloudSaves         → "Cloud Saves"
 *   leaderboardEntries → "Leaderboard Entries"
 *   user_notes         → "User Notes"     (snake_case also handled)
 *
 * Used as the catalog `label` fallback when defineAdminResource() didn't
 * supply one explicitly.
 */
export function humanize(name: string): string {
  return name
    // ALL_CAPS prefix to next word: APIKeys → API Keys, XMLHttpRequest → XML HttpRequest
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // camelCase boundary: cloudSaves → cloud Saves
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // snake_case: underscores become spaces
    .replace(/_+/g, ' ')
    // collapse runs of whitespace
    .replace(/\s+/g, ' ')
    .trim()
    // title-case each word — preserve already-uppercase initials (e.g. "API")
    .split(' ')
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
