import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/lib/theme-provider';

/**
 * Header button that opens a Light/Dark/System radio menu. The icon
 * reflects the resolved theme (Sun for light, Moon for dark) so the
 * trigger always tells the user what they're currently looking at.
 */
export function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="theme-toggle" aria-label="Toggle theme">
          {resolved === 'dark' ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
          <DropdownMenuRadioItem value="light"><Sun className="mr-2 size-3.5" />Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="mr-2 size-3.5" />Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor className="mr-2 size-3.5" />System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
