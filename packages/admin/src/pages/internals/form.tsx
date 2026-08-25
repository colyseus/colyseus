/**
 * Controlled form used by both Edit and Create. Rendering is type-routed:
 *  - one-relation FK columns → RelationPicker
 *  - JSON-ish columns → CodeMirror JsonEditor
 *  - date columns → datetime-local input (formatted as local time)
 *  - numeric / boolean / text → matching native inputs
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JsonEditor } from '@/components/ui/json-editor';
import {
  type Column, type Resource, type ResourceRelation,
  isBoolean, isDate, isJsonish, isNumeric,
} from '../../types';
import { RelationPicker } from './relation-picker';
import { safeParseJson } from './format-cell';

export interface FormBodyProps {
  cols: Column[];
  resources: Resource[];
  oneRelations: ResourceRelation[];
  omitPrimary?: boolean;
  omitDefaulted?: boolean;
  initialValues: Record<string, any>;
  saving: boolean;
  dataTestId: string;
  onSubmit: (values: Record<string, any>) => void;
}

export function FormBody({
  cols, resources, oneRelations, omitPrimary, omitDefaulted, initialValues, saving, dataTestId, onSubmit,
}: FormBodyProps) {
  const [values, setValues] = useState<Record<string, any>>(() => ({ ...initialValues }));
  // Re-seed when initialValues becomes available (e.g. Edit useOne resolves).
  useEffect(() => { setValues({ ...initialValues }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(initialValues)]);
  const fkRelByCol = new Map(oneRelations.map((r) => [r.fk, r]));

  const visible = cols.filter((c) => !(omitPrimary && c.primary) && !(omitDefaulted && c.hasDefault));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, any> = {};
    for (const c of visible) {
      let v = values[c.name];
      if (isJsonish(c) && typeof v === 'string') { v = safeParseJson(v); }
      out[c.name] = v;
    }
    onSubmit(out);
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid={dataTestId}>
      {visible.map((c) => {
        const rel = fkRelByCol.get(c.name);
        // A column is required when (NOT NULL or PK) and no default. PKs
        // are non-null by definition; some drizzle column definitions
        // don't add `.notNull()` to PKs explicitly, so we treat `primary`
        // as implying required when there's no default. Previously a
        // user could create a leaderboard with an empty id, leaving
        // /admin/leaderboards/edit/ unreachable.
        const required = (c.notNull || c.primary) && !c.hasDefault;
        return (
          <div key={c.name} className="space-y-1.5">
            <Label htmlFor={`f-${c.name}`}>
              {c.label}{required && <span className="text-destructive ml-0.5">*</span>}
            </Label>
            {rel ? (
              <RelationPicker
                target={rel.target}
                resources={resources}
                value={values[c.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [c.name]: v }))}
              />
            ) : isJsonish(c) ? (
              <JsonEditor
                value={
                  typeof values[c.name] === 'string'
                    ? values[c.name]
                    // Pretty-print on entry — we get back a single string from
                    // the API; format it so the editor opens to readable JSON.
                    : JSON.stringify(values[c.name] ?? null, null, 2)
                }
                onChange={(next) => setValues((prev) => ({ ...prev, [c.name]: next }))}
                placeholder='valid JSON, e.g. "value" or {"a":1}'
                data-testid={`json-${c.name}`}
              />
            ) : isDate(c) ? (
              <Input
                id={`f-${c.name}`}
                type="datetime-local"
                value={values[c.name] ? toLocalDateTime(values[c.name]) : ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                required={required}
              />
            ) : isNumeric(c) ? (
              <Input
                id={`f-${c.name}`}
                type="number"
                value={values[c.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value === '' ? '' : Number(e.target.value) }))}
                required={required}
              />
            ) : isBoolean(c) ? (
              <select
                id={`f-${c.name}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={values[c.name] === true ? 'true' : values[c.name] === false ? 'false' : ''}
                onChange={(e) => setValues((prev) => ({
                  ...prev,
                  [c.name]: e.target.value === '' ? null : e.target.value === 'true',
                }))}
              >
                <option value=""></option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <Input
                id={`f-${c.name}`}
                value={values[c.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                required={required}
                name={c.name}
              />
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

function toLocalDateTime(v: any): string {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) { return ''; }
  // YYYY-MM-DDTHH:MM in local time
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
