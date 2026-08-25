/**
 * Independently collapsible card section. Used by the user show page
 * to host Active sessions + Audit as standalone panels outside the
 * relation tab strip — each section opens / closes on its own, and
 * the body lazy-mounts (so a closed Active sessions section drops
 * its polling effect entirely instead of running forever in the
 * background).
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CollapsibleSectionProps {
  title: React.ReactNode;
  /** Optional icon rendered to the left of the title — matches the
   *  `iconFor(...)` shape used by the relation-tab labels so the eye
   *  doesn't need to retrain for two different chrome conventions. */
  icon?: React.ReactNode;
  /** Optional count displayed as `(N)` next to the title. Omitted /
   *  hidden when 0 to avoid noisy `(0)` badges on empty sections. */
  count?: number;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title, icon, count, defaultOpen = true, testId, children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="rounded-lg border bg-background" data-testid={testId}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span>{title}</span>
          {count !== undefined && count > 0 && (
            <span className="font-normal text-muted-foreground">({count})</span>
          )}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {/* Lazy-mount the body so a collapsed section stops any internal
          effects (timers, fetch loops) — important for Active sessions
          which otherwise polls forever. Reopening re-runs the effect. */}
      {open && (
        <div className="border-t px-4 py-3">{children}</div>
      )}
    </section>
  );
}
