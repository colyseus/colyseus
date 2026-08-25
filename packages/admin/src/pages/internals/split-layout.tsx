/**
 * Two-column shell for any resource detail page with many-relations.
 *
 *   ┌────────────────┬─────────────────────────────────────┐
 *   │ Profile card   │ Relation tabs                       │
 *   │ (sticky on lg) │ (children of the record)            │
 *   └────────────────┴─────────────────────────────────────┘
 *   ┌─────────────────────────────────────────────────────┐
 *   │ optional `below` — full-width sections under grid   │
 *   └─────────────────────────────────────────────────────┘
 *
 * Generalized from the original users-only split. The `below` prop is
 * where users-specific surfaces (Active sessions, Audit collapsibles)
 * hang off — every other resource passes nothing and gets the bare
 * two-column layout.
 *
 * Stacks to one column below the `lg` breakpoint so mobile/tablet
 * keeps the profile readable above the tabs.
 */
import * as React from 'react';

export interface SplitLayoutProps {
  profile: React.ReactNode;
  /** Pre-built `<Tabs>` element from the caller — keeps per-page
   *  TabsList/TabsContent shape next to that page's handlers. */
  tabs: React.ReactNode;
  /** Eyebrow header above the profile card. Omit to render the card
   *  without a label — the card boundary + page title carry enough
   *  context on detail pages where redundancy reads as noise. */
  profileLabel?: string;
  /** Full-width content rendered under the two-column grid (Active
   *  sessions / Audit collapsibles on users; nothing on other
   *  resources). Wrapped in a vertical stack of its own. */
  below?: React.ReactNode;
}

export function SplitLayout({ profile, tabs, profileLabel, below }: SplitLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
        <aside className="rounded-lg border bg-background p-4 lg:sticky lg:top-4 lg:self-start">
          {profileLabel && (
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {profileLabel}
            </h2>
          )}
          {profile}
        </aside>
        <section className="min-w-0 rounded-lg border bg-background p-4">
          {tabs}
        </section>
      </div>
      {below}
    </div>
  );
}

/**
 * Singularise a humanised plural label for the profile eyebrow header.
 * Naive trailing-`s` strip — handles "Users" → "User", "Leaderboards"
 * → "Leaderboard", "Cloud Saves" → "Cloud Save". Edge cases like
 * "Activities" / "Status" fall through wrong; resource owners can
 * override `label` on `defineAdminResource` for those.
 */
export function singularize(label: string): string {
  return label.length > 1 && label.endsWith('s') ? label.slice(0, -1) : label;
}
