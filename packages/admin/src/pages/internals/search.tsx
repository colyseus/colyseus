import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function SearchInput({
  resourceName, currentValue, onApply,
}: { resourceName: string; currentValue: string; onApply: (v: string) => void }) {
  const [v, setV] = useState(currentValue);
  useEffect(() => { setV(currentValue); }, [currentValue]);
  return (
    <span data-testid={`search-${resourceName}`} className="relative inline-block w-60">
      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onApply(v); }
        }}
        onBlur={() => { if (v !== currentValue) { onApply(v); } }}
        placeholder="Search…"
        className="pl-8"
      />
    </span>
  );
}
