import { useEffect, useMemo, useState } from 'react';
import { useOne } from '@refinedev/core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Resource, ResourceRelation } from '../types';
import { findResource, visibleColumns } from './internals/helpers';
import { formatCell } from './internals/format-cell';
import {
  OneRelationLink, Profilerow, RelatedTable, RelationTabLabel, useRelationCounts,
} from './internals/relations';
import { CompositePkSubtitle } from './internals/composite-pk-subtitle';
import { useFkLabels } from './internals/use-fk-labels';
import { ActiveUserSessionsTab } from './users/active-sessions-tab';
import { iconFor } from '../icons';

/**
 * "Active sessions" tab label. Count comes from the bulk `/_counts`
 * payload (no per-render polling); the tab content drives live
 * updates while it's open.
 */
function ActiveSessionsTabLabel({ count }: { count: number | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {iconFor('radio')}
      <span>
        Active sessions{count !== undefined && count > 0 && (
          <span className="ml-1 text-muted-foreground">({count})</span>
        )}
      </span>
    </span>
  );
}

export function ShowPage({ resources }: { resources: Resource[] }) {
  const params = useParams<{ resource: string; id: string; relation?: string; childId?: string }>();
  const { resource: name, id, relation: nestedRelation, childId: nestedChildId } = params;
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { data, isLoading } = useOne({ resource: name, id });
  const record = (data?.data ?? {}) as any;

  // Nested mode = the URL carries a `:relation/:childId` tail. The
  // matching tab swaps its list for a read-only child profile.
  const isNested = !!(nestedRelation && nestedChildId);

  // Active-tab state. We control `<Tabs>` so the URL can pin the
  // active tab in nested mode (the matching relation tab stays open
  // when the child URL is loaded directly or revisited via back/
  // forward). The effect re-syncs whenever the URL changes — without
  // it, switching from a list tab to a nested child wouldn't reflect.
  const [activeTab, setActiveTab] = useState<string>(nestedRelation ?? '__profile');
  useEffect(() => {
    setActiveTab(nestedRelation ?? '__profile');
  }, [nestedRelation]);
  // Single bulk fetch for every many-relation count — replaces N parallel
  // per-tab requests we used to fire from inside <RelationTabLabel>.
  const counts = useRelationCounts(name, id);

  // Override for the Active sessions badge while the tab is open —
  // keeps the label in sync with the live list instead of the
  // page-open `_counts` snapshot.
  const [liveSessionsCount, setLiveSessionsCount] = useState<number | null>(null);

  // FK label lookup — same hook the list page uses, fed a single-row
  // "list". Stays at 1 query per FK column on the resource (typically 0–2).
  // Memoize the row-array so the hook's dep key is stable across renders.
  const rowsForFkLookup = useMemo(
    () => (record && Object.keys(record).length > 0 ? [record] : []),
    [record],
  );
  const fkLabels = useFkLabels(rowsForFkLookup, def);

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.showFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  // Active sessions tab is bound to the canonical `users` resource —
  // users who rename their users table lose it.
  const showActiveSessions = name === 'users' && !!id;

  // Relation tab → target icon lookup.
  const iconByResource: Record<string, string | undefined> = {};
  for (const r of resources) { iconByResource[r.name] = r.icon; }

  const profile = (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]" data-testid={`show-${name}`}>
      {cols.map((c) => (
        <Profilerow key={c.name} label={c.label}>
          {formatCell(record[c.name], c, fkLabels.get(c.name)?.get(record[c.name]), record, resources, 'show')}
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
      title={
        <>
          {def.label}
          {id && <CompositePkSubtitle def={def} id={id} />}
        </>
      }
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
      ) : (manyRels.length === 0 && !showActiveSessions) || !id ? (
        profile
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            // From nested mode, any tab switch returns the URL to the
            // parent show so the new tab can render its list. The
            // local state then re-syncs from the effect above.
            if (isNested) {
              navigate(`/${name}/show/${id}`);
            }
            setActiveTab(v);
          }}
        >
          <TabsList data-testid={`show-tabs-${name}`}>
            <TabsTrigger value="__profile">
              <span className="inline-flex items-center gap-1.5">
                {iconFor(def.icon)}
                <span>Profile</span>
              </span>
            </TabsTrigger>
            {manyRels.map((rel) => (
              <TabsTrigger key={rel.name} value={rel.name}>
                <RelationTabLabel
                  relation={rel}
                  count={counts?.[rel.name]}
                  targetIcon={iconByResource[rel.target]}
                />
              </TabsTrigger>
            ))}
            {showActiveSessions && (
              <TabsTrigger value="__active_sessions" data-testid="tab-active-sessions">
                <ActiveSessionsTabLabel
                  count={liveSessionsCount ?? counts?.['__active_sessions']}
                />
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="__profile">{profile}</TabsContent>
          {manyRels.map((rel) => (
            <TabsContent key={rel.name} value={rel.name}>
              {isNested && nestedRelation === rel.name && nestedChildId ? (
                <NestedChildShowPanel
                  parentResource={name!}
                  parentId={id}
                  relation={rel}
                  childId={nestedChildId}
                  resources={resources}
                />
              ) : (
                <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />
              )}
            </TabsContent>
          ))}
          {showActiveSessions && (
            <TabsContent value="__active_sessions">
              <ActiveUserSessionsTab
                userId={id}
                onCountChange={setLiveSessionsCount}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </Page>
  );
}

/**
 * Build a standalone-edit URL with an optional `returnTo` query param.
 * The standalone EditPage reads `returnTo` and uses it for both its
 * top-left back arrow and the post-Save redirect, so a user editing
 * a child row from inside a parent's relation tab returns to that
 * same tab instead of refine's default `/<resource>` list.
 */
export function editUrl(resource: string, id: string, returnTo?: string): string {
  const base = `/${resource}/edit/${encodeURIComponent(id)}`;
  return returnTo ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}

/**
 * Read-only child profile rendered inside the parent's relation tab.
 * Phase 1 of the nested-route workflow — Edit/New still link to the
 * standalone pages; later phases will swap those for in-tab forms.
 *
 * Fetches the child row independently of the parent's `useOne` (Refine
 * keys both by `(resource, id)`, so no cache crosstalk).
 */
function NestedChildShowPanel({
  parentResource, parentId, relation, childId, resources,
}: {
  parentResource: string;
  parentId: string;
  relation: ResourceRelation;
  childId: string;
  resources: Resource[];
}) {
  const targetDef = findResource(resources, relation.target);
  const { data, isLoading } = useOne({ resource: relation.target, id: childId });
  const record = (data?.data ?? {}) as any;

  // Same FK-label lookup the parent profile uses — keeps any FK column
  // on the child resolving to a human label instead of a raw id.
  const rowsForFkLookup = useMemo(
    () => (record && Object.keys(record).length > 0 ? [record] : []),
    [record],
  );
  const fkLabels = useFkLabels(rowsForFkLookup, targetDef);

  if (!targetDef) {
    return <Empty title={`unknown target resource '${relation.target}'`} />;
  }
  const cols = visibleColumns(targetDef, targetDef.showFields);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link
            // Land on the tab-pinned URL so the parent's tab strip keeps
            // showing the matching tab open (the bare `/users/show/:id`
            // would defocus back to the Profile tab).
            to={`/${parentResource}/show/${parentId}/${relation.name}`}
            data-testid={`nested-back-${relation.name}`}
          >
            <ArrowLeft className="mr-1 size-4" />
            Back to {relation.label}
          </Link>
        </Button>
        {/* `returnTo` query param tells the standalone edit page where
            to bounce after Save and what its top-left back-arrow points
            at, so the user lands back inside this parent's relation tab
            instead of refine's default `/<resource>` list. */}
        <Button asChild size="sm" variant="outline">
          <Link to={editUrl(relation.target, childId, `/${parentResource}/show/${parentId}/${relation.name}`)}>
            <Pencil className="mr-1 size-4" />
            Edit
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : (
        <dl
          className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]"
          data-testid={`nested-show-${relation.name}`}
        >
          {cols.map((c) => (
            <Profilerow key={c.name} label={c.label}>
              {formatCell(record[c.name], c, fkLabels.get(c.name)?.get(record[c.name]), record, resources, 'show')}
            </Profilerow>
          ))}
        </dl>
      )}
    </div>
  );
}
