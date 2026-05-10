import { useMemo } from 'react';
import { useCreate } from '@refinedev/core';
import { useNavigate, useParams } from 'react-router-dom';
import { Page } from '@/components/ui/page';
import type { Resource } from '../types';
import { findResource, visibleColumns } from './internals/helpers';
import { FormBody } from './internals/form';

export function CreatePage({ resources }: { resources: Resource[] }) {
  const { resource: name } = useParams();
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { mutate: create, isLoading: saving } = useCreate();

  if (!def) { return <div>unknown resource</div>; }
  const cols = visibleColumns(def, def.formFields);
  const oneRels = (def.relations ?? []).filter((r) => r.kind === 'one');

  // ?_prefill_<col>=<value> seeds initial values for the form. Used by the
  // "+ New related" button on relation tabs to pass the parent FK.
  const prefill = useMemo(() => {
    const out: Record<string, any> = {};
    if (typeof window === 'undefined') { return out; }
    for (const [k, v] of new URLSearchParams(window.location.search).entries()) {
      if (k.startsWith('_prefill_')) { out[k.slice('_prefill_'.length)] = v; }
    }
    return out;
  }, []);

  return (
    <Page back={`/${name}`} title={`New ${def.label}`}>
      <FormBody
        cols={cols}
        resources={resources}
        oneRelations={oneRels}
        omitDefaulted
        initialValues={prefill}
        saving={saving}
        dataTestId={`create-${name}`}
        onSubmit={(values) => create({ resource: name!, values }, {
          onSuccess: () => navigate(`/${name}`),
        })}
      />
    </Page>
  );
}
