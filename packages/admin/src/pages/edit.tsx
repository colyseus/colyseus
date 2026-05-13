import { useEffect, useState } from 'react';
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
import { UserSplitLayout } from './users/user-split-layout';
import { SplitLayout, singularize } from './internals/split-layout';
// Re-exported for back-compat with `test/edit-returnto.test.ts` and any
// game code that imported the helper from this module before it moved
// into the shared `internals/return-to`.
export { safeReturnTo } from './internals/return-to';
import { safeReturnTo as resolveReturnTo } from './internals/return-to';

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
  const returnTo = resolveReturnTo(searchParams.get('returnTo'), `/${name}`);

  // Hoisted before the `if (!def)` early-return so the hooks below
  // stay above it (Rules of Hooks). Derived from a maybe-undefined
  // `def` until the early-return narrows it.
  const manyRels = (def?.relations ?? []).filter((r) => r.kind === 'many');

  // Same split-layout gate as ShowPage — any resource with at least
  // one many-relation AND a resolved id renders the Profile-form on
  // the left + relation tabs on the right. Users get the extra
  // Active sessions + Audit collapsibles via the `UserSplitLayout`
  // wrapper; every other resource goes through `SplitLayout`
  // directly.
  const splitLayout = !!id && manyRels.length > 0;
  const isUsersResource = splitLayout && name === 'users';

  const splitLayoutDefault = splitLayout
    ? (manyRels[0]?.name ?? '__profile')
    : '__profile';

  // Active tab in the split-layout's relation strip. Defaults to the
  // first relation (no Profile tab in this mode); the effect re-syncs
  // once `manyRels` is derived from the catalog so the loading paint
  // doesn't pin a stale value.
  const [activeTab, setActiveTab] = useState<string>(splitLayoutDefault);
  useEffect(() => {
    setActiveTab(splitLayoutDefault);
  }, [splitLayoutDefault]);

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.formFields);
  const oneRels = (def.relations ?? []).filter((r) => r.kind === 'one');

  return (
    <Page
      back={returnTo}
      // Split mode takes over framing — see ShowPage for the same trick.
      bare={splitLayout}
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
      ) : (() => {
        // Profile-as-form (left card) + relation tabs (right card).
        // The tab strip is the same shape on every resource —
        // relations only.
        const profileForm = (
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
        );
        const tabsBlock = (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList data-testid={`edit-tabs-${name}`}>
              {manyRels.map((rel) => (
                <TabsTrigger key={rel.name} value={rel.name}>
                  <RelationTabLabel relation={rel} count={counts?.[rel.name]} />
                </TabsTrigger>
              ))}
            </TabsList>
            {manyRels.map((rel) => (
              <TabsContent key={rel.name} value={rel.name}>
                <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />
              </TabsContent>
            ))}
          </Tabs>
        );
        const profileLabel = `Edit ${singularize(def.label)}`;
        return isUsersResource ? (
          <UserSplitLayout
            userId={id}
            counts={counts}
            profile={profileForm}
            tabs={tabsBlock}
            profileLabel={profileLabel}
          />
        ) : (
          <SplitLayout
            profile={profileForm}
            tabs={tabsBlock}
            profileLabel={profileLabel}
          />
        );
      })()}
    </Page>
  );
}
