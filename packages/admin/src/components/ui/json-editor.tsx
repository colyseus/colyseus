import * as React from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from '@/lib/theme-provider';
import { cn } from '@/lib/utils';

/**
 * Interactive JSON field for `jsonb` (pg) and `mode: 'json'` (sqlite)
 * columns. Syntax highlighting, bracket matching, line numbers, and a
 * linter that surfaces parse errors in the gutter as you type.
 *
 * Controlled component (value/onChange) so React Hook Form / our
 * controlled FormBody both drive it identically. Stores the raw string
 * — the form's submit handler runs `JSON.parse` on save (existing
 * behavior), and an invalid blob simply round-trips as a string the
 * backend will reject.
 *
 * Theme: codemirror's oneDark for dark mode, light defaults otherwise.
 * Wrapped to look like the rest of our shadcn inputs (border + bg).
 */
export function JsonEditor({
  value, onChange, placeholder, height = '180px', className, 'data-testid': testid,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  height?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const { resolved } = useTheme();
  const extensions = React.useMemo(
    () => [json(), linter(jsonParseLinter()), lintGutter(), EditorView.lineWrapping],
    [],
  );
  return (
    <div
      className={cn(
        'rounded-md border bg-transparent text-sm shadow-sm',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
        'overflow-hidden',
        className,
      )}
      data-testid={testid}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        height={height}
        placeholder={placeholder}
        theme={resolved === 'dark' ? oneDark : 'light'}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: false,
          highlightSelectionMatches: false,
          autocompletion: false,
        }}
      />
    </div>
  );
}
