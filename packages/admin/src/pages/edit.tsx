import { useOne, useUpdate } from '@refinedev/core';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Page } from '@/components/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Resource } from '../types';
import { findResource, visibleColumns } from './internals/helpers';
import { FormBody } from './internals/form';
import { CompositePkSubtitle } from './internals/composite-pk-subtitle';
import { RelatedTable, RelationTabLabel, useRelationCounts } from './internals/relations';

/**
 * Only accept same-origin paths so a hostile `?returnTo=` link can't
 * pivot the user offsite. Must start with `/` and not with `//` (the
 * protocol-relative escape hatch). Exported for tests.
 */
export function safeReturnTo(raw: string | null, fallback: string): string {
  if (!raw) { return fallback; }
  if (!raw.startsWith('/') || raw.startsWith('//')) { return fallback; }
  return raw;
}

export function EditPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { data, isLoading } = useOne({ resource: name, id });
  const { mutate: update, isLoading: saving } = useUpdate();
  const counts = useRelationCounts(name, id);

  // Where to land after Save and what the page's back-arrow points at.
  // Defaults to the resource list page (refine's original behavior).
  const returnTo = safeReturnTo(searchParams.get('returnTo'), `/${name}`);

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.formFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  return (
    <Page
      back={returnTo}
      title={
        <>
          {def.label}
          {id && <CompositePkSubtitle def={def} id={id} />}
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : manyRels.length === 0 || !id ? (
        <FormBody
          cols={cols}
          resources={resources}
          oneRelations={oneRels}
          omitPrimary
          initialValues={(data?.data ?? {}) as any}
          saving={saving}
          dataTestId={`edit-${name}`}
          onSubmit={(values) => update({ resource: name!, id: id!, values }, {
            onSuccess: () => navigate(returnTo),
          })}
        />
      ) : (
        <Tabs defaultValue="__profile">
          <TabsList data-testid={`edit-tabs-${name}`}>
            <TabsTrigger value="__profile">Profile</TabsTrigger>
            {manyRels.map((rel) => (
              <TabsTrigger key={rel.name} value={rel.name}>
                <RelationTabLabel relation={rel} count={counts?.[rel.name]} />
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="__profile">
            <FormBody
              cols={cols}
              resources={resources}
              oneRelations={oneRels}
              omitPrimary
              initialValues={(data?.data ?? {}) as any}
              saving={saving}
              dataTestId={`edit-${name}`}
              onSubmit={(values) => update({ resource: name!, id, values }, {
                onSuccess: () => navigate(returnTo),
              })}
            />
          </TabsContent>
          {manyRels.map((rel) => (
            <TabsContent key={rel.name} value={rel.name}>
              <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </Page>
  );
}
