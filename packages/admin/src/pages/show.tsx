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
import { withReturnTo } from './internals/return-to';
import { formatCell } from './internals/format-cell';
import {
  OneRelationLink, Profilerow, RelatedTable, RelationTabLabel, useRelationCounts,
} from './internals/relations';
import { CompositePkSubtitle } from './internals/composite-pk-subtitle';
import { useFkLabels } from './internals/use-fk-labels';
import { UserActions } from './users/user-actions';
import { UserSplitLayout } from './users/user-split-layout';
import { SplitLayout, singularize } from './internals/split-layout';
import { iconFor } from '../icons';

export function ShowPage({ resources }: { resources: Resource[] }) {
  const params = useParams<{ resource: string; id: string; relation?: string; childId?: string }>();
  const { resource: name, id, relation: nestedRelation, childId: nestedChildId } = params;
  const navigate = useNavigate();
  const def = findResource(resources, name);
  const { data, isLoading, refetch } = useOne({ resource: name, id });
  const record = (data?.data ?? {}) as any;

  // Nested mode = the URL carries a `:relation/:childId` tail. The
  // matching tab swaps its list for a read-only child profile.
  const isNested = !!(nestedRelation && nestedChildId);

  // Active-tab state. We control `<Tabs>` so the URL can pin the
  // active tab in nested mode (the matching relation tab stays open
  // when the child URL is loaded directly or revisited via back/
  // forward). The effect re-syncs whenever the URL changes — without
  // it, switching from a list tab to a nested child wouldn't reflect.
  //
  // Default tab differs by layout:
  //   - split mode (users): no Profile tab; first relation tab opens
  //     (Active sessions / Audit aren't tabs here — they're collapsible
  //     sections rendered below the grid).
  //   - regular: start on Profile.
  // The default is computed inside the effect below since it depends on
  // `manyRels`, which is derived from the catalog after the early
  // returns.
  const [activeTab, setActiveTab] = useState<string>(nestedRelation ?? '__profile');
  // Single bulk fetch for every many-relation count — replaces N parallel
  // per-tab requests we used to fire from inside <RelationTabLabel>.
  const counts = useRelationCounts(name, id);

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

  // Split layout: profile left, relation tabs right. Applies to ANY
  // resource that has at least one many-relation AND a resolved id —
  // makes the chrome consistent across Users / Leaderboards / Cloud
  // Saves / etc. The users variant additionally renders Active
  // sessions + Audit collapsibles below the grid via
  // `<UserSplitLayout>`; every other resource goes through
  // `<SplitLayout>` directly.
  const splitLayout = !!id && manyRels.length > 0;
  const isUsersResource = splitLayout && name === 'users';

  // Default tab when there's no URL-pinned relation. In split mode
  // there's no Profile tab, so fall back to the first relation; the
  // effect re-syncs on URL changes and on first paint once `manyRels`
  // has been derived (it's an empty array on the loading paint).
  const splitLayoutDefault = splitLayout
    ? (manyRels[0]?.name ?? '__profile')
    : '__profile';
  useEffect(() => {
    setActiveTab(nestedRelation ?? splitLayoutDefault);
  }, [nestedRelation, splitLayoutDefault]);

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
      // Split layout takes over framing so the profile and tabs each
      // get their own card with a visible gap between them. The
      // default single-card wrapper makes the two halves look like
      // one giant panel — see ProtectedShell screenshot.
      bare={splitLayout}
      title={
        <>
          {def.label}
          {id && <CompositePkSubtitle def={def} id={id} />}
        </>
      }
      actions={id && (
        <div className="flex items-center gap-2">
          {/* User-targeted operator workflows (Ban/Unban/Revoke
              sessions) hang off the canonical `users` resource. The
              same `name === 'users'` gate the Active sessions tab
              uses — renames lose it, by design. */}
          {name === 'users' && (
            <UserActions
              userId={id}
              user={record}
              onChanged={() => { void refetch(); }}
            />
          )}
          <Button asChild size="sm" variant="outline">
            <Link to={`/${name}/edit/${id}`}><Pencil />Edit</Link>
          </Button>
        </div>
      )}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> loading…
        </div>
      ) : !splitLayout ? (
        profile
      ) : (() => {
        // Tab strip is the same on every split-layout page (Users,
        // Leaderboards, etc.) — relations only. Built once and
        // handed to whichever shell variant the resource needs.
        const tabsBlock = (
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              if (isNested) { navigate(`/${name}/show/${id}`); }
              setActiveTab(v);
            }}
          >
            <TabsList data-testid={`show-tabs-${name}`}>
              {manyRels.map((rel) => (
                <TabsTrigger key={rel.name} value={rel.name}>
                  <RelationTabLabel
                    relation={rel}
                    count={counts?.[rel.name]}
                    targetIcon={iconByResource[rel.target]}
                  />
                </TabsTrigger>
              ))}
            </TabsList>
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
          </Tabs>
        );
        // Eyebrow header for the profile card — naive singular of the
        // resource label so it reads as "Leaderboard" / "User" /
        // "Cloud Save". Resource owners can override via `label` on
        // `defineAdminResource` for edge cases (e.g. "Activities").
        const profileLabel = singularize(def.label);
        return isUsersResource ? (
          <UserSplitLayout
            userId={id}
            counts={counts}
            profile={profile}
            tabs={tabsBlock}
            profileLabel={profileLabel}
          />
        ) : (
          <SplitLayout
            profile={profile}
            tabs={tabsBlock}
            profileLabel={profileLabel}
          />
        );
      })()}
    </Page>
  );
}

/**
 * Build a standalone-edit URL with an optional `returnTo` query param.
 * Thin wrapper over `withReturnTo` that fixes the `/edit/<id>` shape;
 * kept here (exported) for tests + clarity at the call site.
 */
export function editUrl(resource: string, id: string, returnTo?: string): string {
  return withReturnTo(`/${resource}/edit/${encodeURIComponent(id)}`, returnTo);
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
