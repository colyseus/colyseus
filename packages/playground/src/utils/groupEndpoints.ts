export interface APIEndpoint {
	method: string;
	path: string;
	body: any;
	query: any;
	description: string;
}

export interface IndexedEndpoint {
	endpoint: APIEndpoint;
	index: number;
}

export interface EndpointGroup {
	prefix: string;
	endpoints: IndexedEndpoint[];
}

export interface GroupedEndpoints {
	groups: EndpointGroup[];
	singletons: IndexedEndpoint[];
}

const METHOD_ORDER: Record<string, number> = {
	GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, OPTIONS: 5, HEAD: 6,
};

// Static path segments up to (but not including) the first dynamic segment
// (`:param`, `**:splat`, or `*`). Empty/leading slashes are stripped.
function staticSegments(path: string): string[] {
	const out: string[] = [];
	for (const seg of path.split('/')) {
		if (!seg) continue;
		if (seg.startsWith(':') || seg.startsWith('*')) break;
		out.push(seg);
	}
	return out;
}

function compareEndpoints(a: IndexedEndpoint, b: IndexedEndpoint): number {
	const byPath = a.endpoint.path.localeCompare(b.endpoint.path);
	if (byPath !== 0) return byPath;
	return (METHOD_ORDER[a.endpoint.method] ?? 99) - (METHOD_ORDER[b.endpoint.method] ?? 99);
}

/**
 * Group endpoints by their longest common static path prefix.
 *
 * Strategy: bucket by the first static segment; for each bucket with ≥ 2
 * endpoints, descend one segment at a time while every endpoint in the bucket
 * shares the next segment, capped at `maxDepth`. Buckets with a single
 * endpoint (or endpoints with no static prefix) become singletons.
 */
export function groupEndpointsByPrefix(
	endpoints: APIEndpoint[],
	maxDepth = 2,
): GroupedEndpoints {
	const buckets = new Map<string, IndexedEndpoint[]>();
	const singletons: IndexedEndpoint[] = [];

	endpoints.forEach((endpoint, index) => {
		const item = { endpoint, index };
		const segs = staticSegments(endpoint.path);
		if (segs.length === 0) {
			singletons.push(item);
			return;
		}
		const key = segs[0];
		const bucket = buckets.get(key);
		if (bucket) bucket.push(item);
		else buckets.set(key, [item]);
	});

	const groups: EndpointGroup[] = [];
	for (const [seg, items] of buckets) {
		if (items.length < 2) {
			singletons.push(...items);
			continue;
		}

		let prefix = `/${seg}`;
		for (let depth = 1; depth < maxDepth; depth++) {
			const nextSegs = items.map(it => staticSegments(it.endpoint.path)[depth]);
			if (nextSegs.some(s => !s)) break;
			if (!nextSegs.every(s => s === nextSegs[0])) break;
			prefix = `${prefix}/${nextSegs[0]}`;
		}

		items.sort(compareEndpoints);
		groups.push({ prefix, endpoints: items });
	}

	groups.sort((a, b) => a.prefix.localeCompare(b.prefix));
	singletons.sort(compareEndpoints);

	return { groups, singletons };
}

export function endpointMatchesFilter(endpoint: APIEndpoint, query: string): boolean {
	if (!query) return true;
	const q = query.toLowerCase();
	return (
		endpoint.method.toLowerCase().includes(q) ||
		endpoint.path.toLowerCase().includes(q) ||
		(endpoint.description ?? '').toLowerCase().includes(q)
	);
}
