import { useShow, useNotification } from '@refinedev/core';
import {
  List,
  Show,
  Edit,
  Create,
  useTable,
  useForm,
  EditButton,
  ShowButton,
  DeleteButton,
} from '@refinedev/antd';
import { Table, Form, Input, InputNumber, DatePicker, Space, Descriptions, Tag, Button, Tabs, Empty, Tooltip, Typography, message, Popconfirm } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type Column, type Resource, type ResourceRelation, singlePk, isJsonish, isNumeric, isDate, isBoolean } from './types';

dayjs.extend(relativeTime);

/**
 * Cell renderer for list/detail views. Type-aware:
 *
 *  - null/undefined  → faded em-dash (no more "null" Tag noise)
 *  - boolean         → green/gray Tag with Yes/No
 *  - date / timestamp → relative time + tooltip with full ISO
 *  - JSON / object   → first-line preview, full content in a tooltip
 *  - long-ish ids/strings → truncated + click-to-copy + tooltip
 *  - numbers         → right-aligned with thousand separators
 *  - everything else → plain text
 *
 * Falls back gracefully when `c` is omitted (e.g. relation back-fetches
 * where we don't have column metadata yet).
 */
function format(v: any, c?: Column): React.ReactNode {
  if (v == null) { return <span style={{ color: '#a1a1aa' }}>—</span>; }

  if (c && isBoolean(c)) {
    const b = v === true || v === 1 || v === '1' || v === 'true';
    return <Tag color={b ? 'green' : 'default'}>{b ? 'Yes' : 'No'}</Tag>;
  }

  if (c && isDate(c)) {
    const asDate = v instanceof Date ? v : (typeof v === 'string' || typeof v === 'number') ? new Date(v) : null;
    if (asDate && !isNaN(asDate.getTime())) {
      return (
        <Tooltip title={asDate.toISOString()}>
          <span>{dayjs(asDate).fromNow()}</span>
        </Tooltip>
      );
    }
    return String(v);
  }

  if (c && isNumeric(c) && typeof v === 'number') {
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {Number.isInteger(v) ? v.toLocaleString() : v.toString()}
      </span>
    );
  }

  if (typeof v === 'object' || (c && isJsonish(c) && typeof v === 'string')) {
    const obj = typeof v === 'string' ? safeParse(v) : v;
    const preview = JSON.stringify(obj).slice(0, 60);
    return (
      <Tooltip title={<pre style={{ margin: 0, color: '#fff', fontSize: 11 }}>{JSON.stringify(obj, null, 2)}</pre>}>
        <code style={{ fontSize: 11, color: '#71717a' }}>
          {preview}{JSON.stringify(obj).length > 60 ? '…' : ''}
        </code>
      </Tooltip>
    );
  }

  // Long string (id-shaped) → truncate with copy affordance
  const s = String(v);
  if (s.length > 24 && !/\s/.test(s)) {
    return (
      <Typography.Text
        style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
        copyable={{ text: s, onCopy: () => message.success('copied', 1) }}
      >
        <Tooltip title={s}>{s.slice(0, 8)}…{s.slice(-4)}</Tooltip>
      </Typography.Text>
    );
  }

  return s;
}

function safeParse(raw: string): any {
  try { return JSON.parse(raw); } catch { return raw; }
}

function findResource(resources: Resource[], name?: string): Resource | undefined {
  return resources.find((r) => r.name === name);
}

function visibleColumns(def: Resource, subset: string[] | undefined): Column[] {
  if (!subset || subset.length === 0) { return def.columns; }
  const order = new Map(subset.map((n, i) => [n, i]));
  return def.columns
    .filter((c) => order.has(c.name))
    .sort((a, b) => order.get(a.name)! - order.get(b.name)!);
}

function FormFields({ cols, omitPrimary = false, omitDefaulted = false }: {
  cols: Column[]; omitPrimary?: boolean; omitDefaulted?: boolean;
}) {
  return (
    <>
      {cols
        .filter((c) => !(omitPrimary && c.primary) && !(omitDefaulted && c.hasDefault))
        .map((c) => (
          <Form.Item
            key={c.name}
            label={c.name}
            name={c.name}
            rules={c.notNull && !c.primary && !c.hasDefault
              ? [{ required: true, message: `${c.name} is required` }]
              : undefined}
            getValueFromEvent={isJsonish(c) ? (e) => tryParseJson(e?.target?.value) : undefined}
            getValueProps={isJsonish(c)
              ? (v) => ({ value: typeof v === 'string' ? v : JSON.stringify(v ?? '', null, 0) })
              : undefined}
          >
            {isJsonish(c) ? <Input.TextArea rows={3} placeholder='valid JSON, e.g. "value" or {"a":1}' />
              : isNumeric(c) ? <InputNumber style={{ width: '100%' }} />
              : isDate(c) ? <DatePicker showTime style={{ width: '100%' }} />
              : <Input />}
          </Form.Item>
        ))}
    </>
  );
}

function tryParseJson(raw: any): any {
  if (typeof raw !== 'string') { return raw; }
  try { return JSON.parse(raw); } catch { return raw; }
}

function ActionButton({ resource, action, rowId, onComplete }: {
  resource: string;
  action: { name: string; label: string; perRow: boolean; confirm?: { title?: string; description?: string } };
  rowId?: string;
  onComplete?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { open } = useNotification();

  const run = async () => {
    setBusy(true);
    try {
      const headers: HeadersInit = { 'content-type': 'application/json' };
      const userId = localStorage.getItem('colyseus-admin-user-id') ?? '';
      if (userId) { (headers as any)['X-User-Id'] = userId; }
      const res = await fetch(`/admin-api/${resource}/_action/${action.name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(rowId ? { id: rowId } : {}),
      });
      const text = await res.text();
      if (!res.ok) {
        open?.({ type: 'error', message: `${action.label} failed`, description: text });
      } else {
        open?.({ type: 'success', message: `${action.label} succeeded` });
        onComplete?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <Button
      size="small"
      data-testid={`action-${action.name}-${rowId ?? 'global'}`}
      loading={busy}
      onClick={action.confirm ? undefined : run}
    >
      {action.label}
    </Button>
  );

  if (!action.confirm) { return button; }
  return (
    <Popconfirm
      title={action.confirm.title ?? `Run "${action.label}"?`}
      description={action.confirm.description}
      okText="Confirm"
      cancelText="Cancel"
      onConfirm={run}
    >
      {button}
    </Popconfirm>
  );
}

export function ListPage({ resources }: { resources: Resource[] }) {
  const { resource: resourceName } = useParams();
  const def = findResource(resources, resourceName);
  const pk = def && singlePk(def);
  const { tableProps, tableQueryResult, setFilters, filters } = useTable({
    resource: resourceName,
    syncWithLocation: true,
  });

  if (!def) { return <div data-testid="unknown">unknown resource: {resourceName}</div>; }

  const cols = visibleColumns(def, def.listColumns);
  const rowActions = def.actions.filter((a) => a.perRow);
  const toolbarActions = def.actions.filter((a) => !a.perRow);

  // The current `_q` value comes back through refine's filters array. We use
  // a synthetic filter id `_q` because simple-rest serializes `eq` filters as
  // `field=value` query params — so the backend just reads `ctx.query._q`.
  const currentQ = (filters?.find?.((f: any) => f.field === '_q') as any)?.value ?? '';

  const onRow = (record: any) => ({
    'data-testid': pk ? `row-${record[pk]}` : undefined,
    'data-row-id': pk ? String(record[pk]) : undefined,
  });

  return (
    <List
      headerButtons={({ defaultButtons }) => (
        <Space>
          <span data-testid={`search-${resourceName}`} style={{ display: 'inline-block', width: 240 }}>
            <Input.Search
              allowClear
              placeholder="Search…"
              defaultValue={currentQ}
              onSearch={(value) => {
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                  setFilters([{ field: '_q', operator: 'eq', value: undefined } as any], 'replace');
                } else {
                  setFilters([{ field: '_q', operator: 'eq', value: trimmed } as any], 'replace');
                }
              }}
              style={{ width: '100%' }}
            />
          </span>
          {defaultButtons}
          {toolbarActions.map((a) => (
            <ActionButton
              key={a.name}
              resource={resourceName!}
              action={a}
              onComplete={() => tableQueryResult?.refetch()}
            />
          ))}
        </Space>
      )}
    >
      <div data-testid={`list-${resourceName}`}>
        <Table
          {...tableProps}
          rowKey={pk ?? def.columns[0]!.name}
          onRow={onRow as any}
          size="small"
          scroll={{ x: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  currentQ
                    ? `no ${def.label.toLowerCase()} matching "${currentQ}"`
                    : `no ${def.label.toLowerCase()} yet`
                }
              >
                {!currentQ && (
                  <Link to={`/${resourceName}/create`}>
                    <Button size="small" icon={<PlusOutlined />}>
                      Create one
                    </Button>
                  </Link>
                )}
              </Empty>
            ),
          }}
        >
          {cols.map((c) => (
            <Table.Column key={c.name} dataIndex={c.name} title={c.name} render={(v) => format(v, c)} />
          ))}
          {pk && (
            <Table.Column
              title="actions"
              key="actions"
              render={(_, row: any) => (
                <Space size="small" wrap>
                  <ShowButton hideText size="small" recordItemId={row[pk]} />
                  <EditButton hideText size="small" recordItemId={row[pk]} />
                  <DeleteButton hideText size="small" recordItemId={row[pk]} />
                  {rowActions.map((a) => (
                    <ActionButton
                      key={a.name}
                      resource={resourceName!}
                      action={a}
                      rowId={String(row[pk])}
                      onComplete={() => tableQueryResult?.refetch()}
                    />
                  ))}
                </Space>
              )}
            />
          )}
        </Table>
      </div>
    </List>
  );
}

/**
 * Detail page with tabs:
 *   - Profile        → the row's column data (default tab)
 *   - <one-relation> → a clickable Tag-link to the related row (kind: 'one')
 *   - <many-rel>     → a paginated mini-table of related rows (kind: 'many')
 *
 * Many-relations also get a count badge in the tab title. Both kinds fetch
 * /admin-api/:resource/:id/relations/:name; counts come from the
 * `x-total-count` header.
 */
export function ShowPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const def = findResource(resources, name);
  const { queryResult } = useShow({ resource: name });
  const record = queryResult?.data?.data ?? {};

  if (!def) { return <div>unknown resource</div>; }
  const cols = visibleColumns(def, def.showFields);
  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');
  const oneRels = relations.filter((r) => r.kind === 'one');

  const profileTab = (
    <Descriptions bordered column={1} size="small" data-testid={`show-${name}`}>
      {cols.map((c) => (
        <Descriptions.Item key={c.name} label={c.name}>
          {format((record as any)[c.name], c)}
        </Descriptions.Item>
      ))}
      {oneRels.length > 0 && id && (
        <Descriptions.Item label="related">
          <Space wrap size="small">
            {oneRels.map((rel) => (
              <OneRelationLink
                key={rel.name}
                parentResource={name!}
                parentId={id}
                relation={rel}
                resources={resources}
              />
            ))}
          </Space>
        </Descriptions.Item>
      )}
    </Descriptions>
  );

  const items = [
    { key: '__profile', label: 'Profile', children: profileTab },
    ...manyRels.map((rel) => ({
      key: rel.name,
      label: <RelationTabLabel parentResource={name!} parentId={id!} relation={rel} />,
      children: id ? (
        <RelatedTable
          parentResource={name!}
          parentId={id}
          relation={rel}
          resources={resources}
        />
      ) : null,
    })),
  ];

  return (
    <Show isLoading={queryResult?.isLoading}>
      <Tabs defaultActiveKey="__profile" items={items} data-testid={`show-tabs-${name}`} />
    </Show>
  );
}

/** Renders the tab title with a `(count)` badge fetched from `x-total-count`. */
function RelationTabLabel({
  parentResource, parentId, relation,
}: { parentResource: string; parentId: string; relation: ResourceRelation }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=0&_end=1`, {
      credentials: 'include',
    })
      .then((r) => {
        if (!r.ok) { return null; }
        const total = r.headers.get('x-total-count');
        return total ? Number(total) : null;
      })
      .then(setCount)
      .catch(() => setCount(null));
  }, [parentResource, parentId, relation.name]);
  return (
    <span data-testid={`tab-relation-${relation.name}`}>
      {relation.name}{count !== null ? ` (${count})` : ''}
    </span>
  );
}

/** Paginated mini-table for a `many` relation. */
function RelatedTable({
  parentResource, parentId, relation, resources,
}: {
  parentResource: string;
  parentId: string;
  relation: ResourceRelation;
  resources: Resource[];
}) {
  const targetDef = findResource(resources, relation.target);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    const start = (page - 1) * pageSize;
    fetch(
      `/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=${start}&_end=${start + pageSize}`,
      { credentials: 'include' },
    )
      .then(async (r) => {
        if (!r.ok) { return { rows: [], total: 0 }; }
        const totalHeader = r.headers.get('x-total-count');
        return { rows: await r.json() as any[], total: totalHeader ? Number(totalHeader) : 0 };
      })
      .then(({ rows, total }) => {
        setRows(rows);
        setTotal(total);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [parentResource, parentId, relation.name, page]);

  if (!targetDef) {
    return <Empty description={`unknown target resource '${relation.target}'`} />;
  }

  const targetPk = singlePk(targetDef);
  const cols = visibleColumns(targetDef, targetDef.listColumns);

  // "+ New <target>" button — opens Create form on the target with the FK
  // pre-filled via URL param, so support agents grant items / send mail
  // without re-typing the userId.
  const fk = relation.fk; // optional metadata not always present
  const newHref = `/${relation.target}/create?_prefill_${fk ?? 'fk'}=${encodeURIComponent(parentId)}`;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Link to={newHref}>
          <Button
            size="small"
            type="default"
            icon={<PlusOutlined />}
            data-testid={`new-related-${relation.name}`}
          >
            New {targetDef.label}
          </Button>
        </Link>
      </div>
      <Table
        size="small"
        data-testid={`related-${relation.name}`}
        loading={loading}
        rowKey={(r, i) => (targetPk ? r[targetPk] : i) as any}
        dataSource={rows}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`no ${targetDef.label.toLowerCase()} yet`}
            >
              <Link to={newHref}>
                <Button size="small" icon={<PlusOutlined />}>
                  Create one
                </Button>
              </Link>
            </Empty>
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
        scroll={{ x: true }}
      >
        {cols.map((c) => (
          <Table.Column
            key={c.name}
            title={c.name}
            dataIndex={c.name}
            render={(v, row: any) => {
              if (targetPk && c.name === targetPk) {
                return <Link to={`/${relation.target}/show/${row[targetPk]}`}>{format(v, c)}</Link>;
              }
              return format(v, c);
            }}
          />
        ))}
      </Table>
    </>
  );
}

/** Clickable Tag for a `one` relation — fetches the row, then links to its Show page. */
function OneRelationLink({
  parentResource, parentId, relation, resources,
}: {
  parentResource: string;
  parentId: string;
  relation: ResourceRelation;
  resources: Resource[];
}) {
  const targetDef = findResource(resources, relation.target);
  const [row, setRow] = useState<any | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetch(`/admin-api/${parentResource}/${parentId}/relations/${relation.name}?_start=0&_end=1`, {
      credentials: 'include',
    })
      .then(async (r) => (r.ok ? (await r.json()) as any[] : []))
      .then((rows) => {
        if (rows.length === 0) { setEmpty(true); }
        else { setRow(rows[0]); }
      })
      .catch(() => setEmpty(true));
  }, [parentResource, parentId, relation.name]);

  if (empty) { return <Tag>{relation.name}: <em>none</em></Tag>; }
  if (!row || !targetDef) { return <Tag>{relation.name}: …</Tag>; }
  const targetPk = singlePk(targetDef);
  if (!targetPk) {
    // Composite-PK target — show without link
    return <Tag color="blue">{relation.name}</Tag>;
  }
  return (
    <Link
      to={`/${relation.target}/show/${row[targetPk]}`}
      data-testid={`one-relation-${relation.name}`}
    >
      <Tag color="blue">{relation.name}: {String(row[targetPk])}</Tag>
    </Link>
  );
}

/**
 * Edit page mirrors the Show page layout: tabbed Profile + relation tabs.
 * Editing happens on the Profile tab; the relation tabs reuse RelatedTable
 * so support agents can navigate between a user's row and their saves /
 * items / leaderboard entries without leaving the edit context.
 */
export function EditPage({ resources }: { resources: Resource[] }) {
  const { resource: name, id } = useParams();
  const def = findResource(resources, name);
  const { formProps, saveButtonProps, queryResult } = useForm({ resource: name, action: 'edit' });

  if (!def) { return <div>unknown resource</div>; }

  const cols = visibleColumns(def, def.formFields);
  const initialValues = { ...(queryResult?.data?.data ?? {}) } as any;
  for (const c of cols) {
    if (isDate(c) && initialValues[c.name]) { initialValues[c.name] = dayjs(initialValues[c.name]); }
  }

  const relations = def.relations ?? [];
  const manyRels = relations.filter((r) => r.kind === 'many');

  const formTab = (
    <Form {...formProps} layout="vertical" initialValues={initialValues} data-testid={`edit-${name}`}>
      <FormFields cols={cols} omitPrimary />
    </Form>
  );

  if (manyRels.length === 0 || !id) {
    return (
      <Edit saveButtonProps={saveButtonProps} isLoading={queryResult?.isLoading}>
        {formTab}
      </Edit>
    );
  }

  const items = [
    { key: '__profile', label: 'Profile', children: formTab },
    ...manyRels.map((rel) => ({
      key: rel.name,
      label: <RelationTabLabel parentResource={name!} parentId={id} relation={rel} />,
      children: <RelatedTable parentResource={name!} parentId={id} relation={rel} resources={resources} />,
    })),
  ];

  return (
    <Edit saveButtonProps={saveButtonProps} isLoading={queryResult?.isLoading}>
      <Tabs defaultActiveKey="__profile" items={items} data-testid={`edit-tabs-${name}`} />
    </Edit>
  );
}

/**
 * Create form. Reads `?_prefill_<col>=<value>` query params to seed initial
 * values — used by the "New related" button on relation tabs to pass the
 * parent FK without manual entry.
 */
export function CreatePage({ resources }: { resources: Resource[] }) {
  const { resource: name } = useParams();
  const def = findResource(resources, name);
  const { formProps, saveButtonProps } = useForm({ resource: name, action: 'create' });

  if (!def) { return <div>unknown resource</div>; }
  const cols = visibleColumns(def, def.formFields);

  // Pull `_prefill_*` params off the URL to seed initial values.
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const prefill: Record<string, any> = {};
  if (search) {
    for (const [k, v] of search.entries()) {
      if (k.startsWith('_prefill_')) { prefill[k.slice('_prefill_'.length)] = v; }
    }
  }

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        initialValues={prefill}
        data-testid={`create-${name}`}
      >
        <FormFields cols={cols} omitDefaulted />
      </Form>
    </Create>
  );
}

