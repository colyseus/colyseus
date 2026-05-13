/**
 * Render-time tests for the related-rows table inside a parent's
 * show-page tab. Targets the pure `<RelatedTableView>` (extracted
 * from `<RelatedTable>`) so we don't need jsdom — `react-dom/server`
 * renders to a string we string-search for the load-bearing
 * affordances (eye-button drill-in link, action column, etc.).
 *
 * StaticRouter wraps the tree so `<Link>` resolves URLs the same way
 * BrowserRouter does at runtime.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
// React Router v7 re-exports StaticRouter from the top-level package
// (v6 had it at `react-router-dom/server`, which v7 removed).
import { StaticRouter } from 'react-router-dom';
import { RelatedTableView } from '../src/pages/internals/relations';
import type { Resource } from '../src/types';

// Composite-PK target mirroring the framework's `cloudSaves` table —
// userId + slot make the PK, and `userId` carries an auto-emitted FK
// linkTo to `users`. The combination is the case that was breaking
// drill-in clicks (inner FK link stealing the outer row-wrap link).
function cloudSavesDef(): Resource {
  return {
    name: 'cloudSaves',
    label: 'Cloud Saves',
    icon: 'cloud',
    columns: [
      {
        name: 'user_id',
        label: 'user_id',
        type: 'text',
        dataType: 'string',
        notNull: true,
        primary: false,
        // FK link — exact shape the FK-derived catalog code emits.
        linkTo: { resource: 'users', pkColumn: 'id', labelColumn: null },
      },
      { name: 'slot', label: 'slot', type: 'integer', dataType: 'number', notNull: true, primary: false },
      { name: 'version', label: 'version', type: 'integer', dataType: 'number', notNull: true, primary: false },
    ],
    primaryKey: ['user_id', 'slot'],
    actions: [],
    relations: [],
  } as unknown as Resource;
}

function renderView(opts: {
  rows: any[];
  loading?: boolean;
  total?: number;
} = { rows: [] }) {
  const targetDef = cloudSavesDef();
  return renderToString(
    <StaticRouter location="/users/show/U1">
      <RelatedTableView
        parentResource="users"
        parentId="U1"
        relation={{
          name: 'cloudSaves',
          target: 'cloudSaves',
          kind: 'many',
          label: 'Cloud Saves',
          fk: 'user_id',
        }}
        targetDef={targetDef}
        rows={opts.rows}
        loading={opts.loading ?? false}
        total={opts.total ?? opts.rows.length}
        page={1}
        pageSize={20}
        onPageChange={() => {}}
      />
    </StaticRouter>,
  );
}

describe('RelatedTableView', () => {
  it('emits an action column header even on an otherwise empty grid', () => {
    const html = renderView({
      rows: [{ user_id: 'U1', slot: 0, version: 1 }],
    });
    // Column headers for the data columns AND a trailing action <th>.
    // The action header is empty (aria-label only) — assert by counting
    // <th> elements: 3 data cols + 1 action.
    const thCount = (html.match(/<th\b/g) ?? []).length;
    assert.equal(thCount, 4, `expected 4 <th> (3 data + 1 action), got ${thCount}`);
  });

  it('renders the eye-button drill-in link on every row (composite-PK target)', () => {
    const rows = [
      { user_id: 'U1', slot: 0, version: 1 },
      { user_id: 'U1', slot: 1, version: 1 },
    ];
    const html = renderView({ rows });

    // Each row's testid uses the encoded composite id. The encoding is
    // deterministic — base64url of JSON tuple — so we just assert the
    // testid PREFIX appears twice (matches both rows).
    const matches = html.match(/data-testid="related-view-cloudSaves-/g) ?? [];
    assert.equal(matches.length, rows.length, `expected ${rows.length} drill-in buttons, got ${matches.length}`);
  });

  it('renders an Edit button next to View on every row, with a returnTo query param', () => {
    const rows = [
      { user_id: 'U1', slot: 0, version: 1 },
      { user_id: 'U1', slot: 1, version: 1 },
    ];
    const html = renderView({ rows });

    // One Edit button per row.
    const editMatches = html.match(/data-testid="related-edit-cloudSaves-/g) ?? [];
    assert.equal(editMatches.length, rows.length, `expected ${rows.length} edit buttons`);

    // The href points at the standalone edit page AND carries `returnTo`
    // pointing back at the parent-pinned URL — so Save lands on the
    // parent's tab, not refine's `/cloudSaves` list.
    assert.match(
      html,
      /href="\/cloudSaves\/edit\/[A-Za-z0-9_-]+\?returnTo=%2Fusers%2Fshow%2FU1%2FcloudSaves"/,
      'edit href must carry an encoded returnTo to the parent tab URL',
    );
  });

  it('the drill-in link points at the parent show URL with the encoded child id', () => {
    const html = renderView({
      rows: [{ user_id: 'U1', slot: 0, version: 1 }],
    });
    // Anchor href must start with the parent context — that's the
    // whole point of Phase 1 (the parent's URL stays anchored).
    assert.match(
      html,
      /href="\/users\/show\/U1\/cloudSaves\/[A-Za-z0-9_-]+"/,
      'drill-in link must include /users/show/U1/cloudSaves/<encoded-id>',
    );
  });

  it('the action column survives even when the first data column carries an FK linkTo', () => {
    // Specific regression for the bug that prompted the refactor:
    // `user_id` has its own anchor (from FK linkTo). The eye button
    // is in a SEPARATE cell so the two anchors don't nest.
    const html = renderView({
      rows: [{ user_id: 'U1', slot: 0, version: 1 }],
    });
    // The FK link on user_id renders an anchor to /users/show/U1.
    assert.match(html, /href="\/users\/show\/U1"/, 'FK linkTo anchor must still render');
    // The drill-in link is a DIFFERENT anchor in the trailing cell.
    assert.match(html, /href="\/users\/show\/U1\/cloudSaves\//, 'drill-in anchor must coexist');
    // And they must NOT be nested — one </a> closes between them.
    const firstFK = html.indexOf('href="/users/show/U1"');
    const firstDrill = html.indexOf('href="/users/show/U1/cloudSaves/');
    assert.ok(firstFK < firstDrill, 'FK link must come before drill-in link');
    const between = html.slice(firstFK, firstDrill);
    assert.ok(between.includes('</a>'), 'FK link must close before the drill-in link opens');
  });

  it('renders an empty-state CTA instead of the table when there are no rows', () => {
    const html = renderView({ rows: [], total: 0 });
    assert.match(html, /no cloud saves yet/);
    // No action column when the table itself isn't rendered.
    assert.doesNotMatch(html, /data-testid="related-view-cloudSaves-/);
  });

  it('renders a loading spinner before the first response lands', () => {
    const html = renderView({ rows: [], loading: true });
    // Loader2 from lucide renders an <svg>; class name `animate-spin`
    // is the cheap marker for "we're in the spinner state".
    assert.match(html, /animate-spin/);
  });
});
