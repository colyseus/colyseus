import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Page-level chrome shared between List / Show / Edit / Create. Replaces
 * refine-antd's `<List>` / `<Show>` / `<Edit>` / `<Create>` wrappers.
 *
 *  - `back`    optional URL for a Back button on the left
 *  - `title`   page heading
 *  - `actions` right-aligned content (header buttons, save button, etc.)
 *  - `footer`  bottom row (e.g. save/cancel pair)
 */
export function Page({
  back, title, actions, children, footer, className,
}: {
  back?: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header wraps on narrow viewports so long titles + many actions
          stack instead of overflowing horizontally. `min-w-0` on the
          title side lets a long page title shrink with ellipsis when
          actions occupy the same row. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {back && (
            <Button variant="ghost" size="icon" asChild>
              <Link to={back}><ArrowLeft /></Link>
            </Button>
          )}
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {/* Inner padding tapers on mobile — `p-4` already, kept consistent
          across breakpoints since 16px is the smallest comfortable
          content padding regardless of viewport. */}
      <div className="rounded-lg border bg-background p-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
    </div>
  );
}
