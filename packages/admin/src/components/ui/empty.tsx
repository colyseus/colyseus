import * as React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Empty-state placeholder. Drop-in replacement for AntD's `<Empty>` —
 * centered icon + description + optional CTA via children.
 */
export function Empty({
  icon = <Inbox className="size-8 text-muted-foreground" />,
  title,
  className,
  children,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-center', className)}>
      {icon}
      {title && <div className="text-sm text-muted-foreground">{title}</div>}
      {children}
    </div>
  );
}
