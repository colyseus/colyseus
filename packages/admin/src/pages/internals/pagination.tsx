import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Pagination({ current, pageSize, total, onChange }: {
  current: number; pageSize: number; total: number; onChange: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <div>
        Page {current} of {pages} · {total.toLocaleString()} rows
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border bg-muted px-3 text-sm font-medium text-foreground">
          {current}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={current >= pages}
          onClick={() => onChange(current + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
