import { useOne } from '@refinedev/core';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Page } from '@/components/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Resource } from '../types';
import { findResource, visibleColumns } from './internals/helpers';
import { formatCell } from './internals/format-cell';
import {
  OneRelationLink, Profilerow, RelatedTable, RelationTabLabel, useRelationCounts,
} from './internals/relations';

export function ShowPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const def = findResource(resources, name);
  const { data, isLoading } = useOne({ resource: name, id });
  const record = (data?.data ?? {}) as any;
  // Single bulk fetch for every many-relation count — replaces N parallel
  // per-tab requests we used to fire from inside <RelationTabLabel>.
  const counts = useRelationCounts(name, id);

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.showFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  const profile = (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]" data-testid={`show-${name}`}>
      {cols.map((c) => (
        <Profilerow key={c.name} label={c.label}>
          {formatCell(record[c.name], c)}
        </Profilerow>
      ))}
      {oneRels.length > 0 && id && (
        <Profilerow label="related">
          <div className="flex flex-wrap gap-2">
            {oneRels.map((rel) => (
              <OneRelationLink
                key={rel.name}
                parentResource={name!}
                parentId={id}
                relation={rel}
                resources={resources}
              />
            ))}
          </div>
        </Profilerow>
      )}
    </dl>
  );

  return (
    <Page
      back={`/${name}`}
      title={def.label}
      actions={id && (
        <Button asChild size="sm" variant="outline">
          <Link to={`/${name}/edit/${id}`}><Pencil />Edit</Link>
        </Button>
      )}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : manyRels.length === 0 || !id ? (
        profile
      ) : (
        <Tabs defaultValue="__profile">
          <TabsList data-testid={`show-tabs-${name}`}>
            <TabsTrigger value="__profile">Profile</TabsTrigger>
            {manyRels.map((rel) => (
              <TabsTrigger key={rel.name} value={rel.name}>
                <RelationTabLabel relation={rel} count={counts?.[rel.name]} />
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="__profile">{profile}</TabsContent>
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
