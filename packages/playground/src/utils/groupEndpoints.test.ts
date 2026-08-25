import { describe, expect, it } from 'vitest';
import {
	endpointMatchesFilter,
	groupEndpointsByPrefix,
	type APIEndpoint,
} from './groupEndpoints';

const ep = (method: string, path: string, description = ''): APIEndpoint => ({
	method, path, body: undefined, query: undefined, description,
});

describe('groupEndpointsByPrefix', () => {
	it('buckets by first segment when sub-segments differ', () => {
		const { groups, singletons } = groupEndpointsByPrefix([
			ep('GET', '/things'),
			ep('GET', '/things/:id'),
			ep('POST', '/things/bulk'),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].prefix).toBe('/things');
		expect(groups[0].endpoints).toHaveLength(3);
		expect(singletons).toEqual([]);
	});

	it('descends to a deeper prefix when every endpoint shares the next segment', () => {
		const { groups } = groupEndpointsByPrefix([
			ep('GET', '/api/v1/players/me'),
			ep('PATCH', '/api/v1/players/me/profile'),
			ep('GET', '/api/v1/articles'),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].prefix).toBe('/api/v1');
	});

	it('respects the depth cap', () => {
		const { groups } = groupEndpointsByPrefix(
			[ep('GET', '/a/b/c/x'), ep('GET', '/a/b/c/y')],
			2,
		);
		expect(groups[0].prefix).toBe('/a/b');
	});

	it('stops descent at dynamic segments', () => {
		const { groups } = groupEndpointsByPrefix([
			ep('GET', '/admin-api/:resource'),
			ep('GET', '/admin-api/:resource/:id'),
			ep('POST', '/admin-api/:resource'),
		]);
		expect(groups[0].prefix).toBe('/admin-api');
	});

	it('does not descend when only some endpoints have the next segment', () => {
		const { groups } = groupEndpointsByPrefix([
			ep('GET', '/api'),
			ep('GET', '/api/v1/foo'),
			ep('GET', '/api/v1/bar'),
		]);
		expect(groups[0].prefix).toBe('/api');
	});

	it('places single-endpoint buckets into singletons', () => {
		const { groups, singletons } = groupEndpointsByPrefix([
			ep('POST', '/users'),
			ep('POST', '/things'),
			ep('GET', '/things/:id'),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].prefix).toBe('/things');
		expect(singletons.map(s => s.endpoint.path)).toEqual(['/users']);
	});

	it('treats fully dynamic paths as singletons', () => {
		const { groups, singletons } = groupEndpointsByPrefix([
			ep('GET', '/:foo'),
			ep('GET', '/things'),
		]);
		expect(groups).toEqual([]);
		expect(singletons.map(s => s.endpoint.path).sort()).toEqual(['/:foo', '/things']);
	});

	it('sorts groups alphabetically and endpoints by path/method order', () => {
		const { groups } = groupEndpointsByPrefix([
			ep('POST', '/things'),
			ep('GET', '/things'),
			ep('GET', '/monitor/api'),
			ep('GET', '/monitor/'),
		]);
		expect(groups.map(g => g.prefix)).toEqual(['/monitor', '/things']);
		expect(groups[1].endpoints.map(e => e.endpoint.method)).toEqual(['GET', 'POST']);
	});

	it('preserves original endpoint index for selection round-trips', () => {
		const inputs = [
			ep('GET', '/things'),
			ep('POST', '/users'),
			ep('GET', '/things/:id'),
		];
		const { groups, singletons } = groupEndpointsByPrefix(inputs);
		const all = [...groups.flatMap(g => g.endpoints), ...singletons];
		for (const item of all) {
			expect(inputs[item.index]).toBe(item.endpoint);
		}
	});
});

describe('endpointMatchesFilter', () => {
	const e = ep('POST', '/api/v1/things/bulk-delete', 'Delete many things');

	it('returns true on empty query', () => {
		expect(endpointMatchesFilter(e, '')).toBe(true);
	});

	it('matches method case-insensitively', () => {
		expect(endpointMatchesFilter(e, 'post')).toBe(true);
		expect(endpointMatchesFilter(e, 'get')).toBe(false);
	});

	it('matches against path substrings', () => {
		expect(endpointMatchesFilter(e, 'bulk')).toBe(true);
	});

	it('matches against description substrings', () => {
		expect(endpointMatchesFilter(e, 'many')).toBe(true);
	});

	it('returns false on miss', () => {
		expect(endpointMatchesFilter(e, 'zzz')).toBe(false);
	});
});
