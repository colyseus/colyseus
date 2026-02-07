import type { Router, HasRequiredKeys, Prettify, UnionToIntersection, Endpoint, HTTPMethod } from "@colyseus/better-call";
import { ColyseusSDK } from "./Client.ts";
import { ServerError } from "./errors/Errors.ts";

/**
 * TODO: we should clean up the types repetition in this file.
 */

// Helper to check if a type is 'any'
type IsAny<T> = 0 extends 1 & T ? true : false;

// Helper to check if a type resolves to any after indexed access
// When T is any, T[K] is also any, but IsAny<T[K]> may not detect it due to deferred evaluation
// We check multiple characteristics of 'any':
// 1. Direct any check: IsAny<T>
// 2. Accepts all string keys: string extends keyof T
// 3. Accepts all number and symbol keys: for complete 'any' detection
type IsAnyOrAnyIndexed<T> = IsAny<T> extends true
    ? true
    : (string extends keyof T
        ? true
        : (number extends keyof T
            ? (symbol extends keyof T ? true : false)
            : false));

type HasRequired<
    T extends {
        body?: any;
        query?: any;
        params?: any;
    },
> = T["body"] extends object
    ? HasRequiredKeys<T["body"]> extends true
        ? true
        : T["query"] extends object
            ? HasRequiredKeys<T["query"]> extends true
                ? true
                : T["params"] extends object
                    ? HasRequiredKeys<T["params"]>
                    : false
            : T["params"] extends object
                ? HasRequiredKeys<T["params"]>
                : false
    : T["query"] extends object
        ? HasRequiredKeys<T["query"]> extends true
            ? true
            : T["params"] extends object
                ? HasRequiredKeys<T["params"]>
                : false
        : T["params"] extends object
            ? HasRequiredKeys<T["params"]>
            : false;

type InferContext<T> = T extends (ctx: infer Ctx) => any
    ? Ctx extends object
        ? Ctx
        : never
    : never;

// WithRequired - makes specific keys required
// This works by spreading T and then overriding the specified keys to be non-nullable
type WithRequired<T, K extends keyof any> = Prettify<T & {
    [P in K & keyof T]-?: NonNullable<T[P]>
}>;

type WithoutServerOnly<T extends Record<string, Endpoint>> = {
    [K in keyof T]: T[K] extends Endpoint<any, infer O>
        ? O extends { metadata: { SERVER_ONLY: true } }
            ? never
            : T[K]
        : T[K];
};

// Method-specific options type
type MethodOptions<API, M extends HTTPMethod> = API extends { [key: string]: infer T; }
    ? T extends Endpoint<any, infer O>
        ? O["method"] extends M
            ? { [key in T["path"]]: T; }
            : O["method"] extends M[]
                ? M extends O["method"][number]
                    ? { [key in T["path"]]: T; }
                    : {}
                : O["method"] extends "*"
                    ? { [key in T["path"]]: T; }
                    : {}
        : {}
    : {};

export type RequiredOptionKeys<
    C extends {
        body?: any;
        query?: any;
        params?: any;
    },
> = (C["body"] extends object
    ? HasRequiredKeys<C["body"]> extends true
        ? { body: true }
        : {}
    : {}) &
    (C["query"] extends object
        ? HasRequiredKeys<C["query"]> extends true
            ? { query: true }
            : {}
        : {}) &
    (C["params"] extends object
        ? HasRequiredKeys<C["params"]> extends true
            ? { params: true }
            : {}
        : {});


type CommonHeaders = {
    accept: "application/json" | "text/plain" | "application/octet-stream";
    "content-type": "application/json" | "text/plain" | "application/x-www-form-urlencoded" | "multipart/form-data" | "application/octet-stream";
    authorization: "Bearer" | "Basic";
};

type FetchRequestOptions<
  Body = any,
  Query extends Record<string, any> = any,
  Params extends Record<string, any> | Array<string> | undefined = any, Res = any,
  ExtraOptions extends Record<string, any> = {}
> = Prettify<ExtraOptions & Omit<RequestInit, "body"> & {
//   baseURL?: string;

  /**
   * Headers
   */
  headers?: CommonHeaders | Headers | HeadersInit;

  /**
   * Body
   */
  body?: Body;

  /**
   * Query parameters (key-value pairs)
   */
  query?: Query;

  /**
   * Dynamic parameters.
   *
   * If url is defined as /path/:id, params will be { id: string }
   */
  params?: Params;
}>

type FetchResponse<T> = {
  raw: Response;
  data: T;
  headers: Headers;
  status: number;
  statusText: string;
};

export function isJSONSerializable(value: any) {
	if (value === undefined) {
		return false;
	}
	const t = typeof value;
	if (t === "string" || t === "number" || t === "boolean" || t === null) {
		return true;
	}
	if (t !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return true;
	}
	if (value.buffer) {
		return false;
	}
	return (
		(value.constructor && value.constructor.name === "Object") ||
		typeof value.toJSON === "function"
	);
}

const JSON_RE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json(;.+)?$/i;

export type ResponseType = "json" | "text" | "blob";
export function detectResponseType(request: Response): ResponseType {
	const _contentType = request.headers.get("content-type");
	const textTypes = new Set([
		"image/svg",
		"application/xml",
		"application/xhtml",
		"application/html",
	]);
	if (!_contentType) {
		return "json";
	}
	const contentType = _contentType.split(";").shift() || "";
	if (JSON_RE.test(contentType)) {
		return "json";
	}
	if (textTypes.has(contentType) || contentType.startsWith("text/")) {
		return "text";
	}
	return "blob";
}

function getURLWithQueryParams(url: string, option?: FetchRequestOptions) {
	const { params, query } = option || {};

	// Parse the URL and extract existing query parameters
	const [urlPath, urlQuery] = url.split("?");
	let path = urlPath;

	// Handle params substitution
	if (params) {
		if (Array.isArray(params)) {
			const paramPaths = path.split("/").filter((p) => p.startsWith(":"));
			for (const [index, key] of paramPaths.entries()) {
				const value = params[index];
				path = path.replace(key, value);
			}
		} else {
			for (const [key, value] of Object.entries(params)) {
				path = path.replace(`:${key}`, String(value));
			}
		}
	}

	// Merge query parameters from URL and options
	const queryParams = new URLSearchParams(urlQuery);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value == null) continue;
			queryParams.set(key, String(value));
		}
	}

	// Build final URL
	let queryParamString = queryParams.toString();
	queryParamString = queryParamString.length > 0 ? `?${queryParamString}`.replace(/\+/g, "%20") : "";

	return `${path}${queryParamString}`;
}

type InferredAPI<R> = R extends { endpoints: Record<string, Endpoint> }
    ? WithoutServerOnly<R["endpoints"]>
    : WithoutServerOnly<R & Record<string, Endpoint>>;

// Helper type to resolve return type, returning 'any' when R is untyped
type InferReturnType<R, OPT, K extends keyof OPT> =
    IsAnyOrAnyIndexed<R> extends true
        ? any
        : Awaited<ReturnType<OPT[K] extends Endpoint ? OPT[K] : never>>;

export class HTTP<R extends Router | Router["endpoints"]> {
    public authToken: string | undefined;
    public options: FetchRequestOptions;

    private sdk: ColyseusSDK;

    // alias "del()" to "delete()"
    public del = this.delete;

    constructor(sdk: ColyseusSDK, baseOptions: FetchRequestOptions) {
        this.sdk = sdk;
        this.options = baseOptions;
    }

    private async request<
        M extends HTTPMethod,
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, M>>> = Prettify<UnionToIntersection<MethodOptions<API, M>>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        method: M,
        path: K,
        options?: FetchRequestOptions<C["body"], C["query"], C["params"]>
    ): Promise<
        FetchResponse<Awaited<ReturnType<OPT[K] extends Endpoint ? OPT[K] : never>>>
    > {
        return this.executeRequest(method, path, options);
    }

    // Overload for endpoints WITH required fields (body/query/params)
    get<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "GET">>> = Prettify<UnionToIntersection<MethodOptions<API, "GET">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends true ? K : never),
        options: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : WithRequired<FetchRequestOptions<C["body"], C["query"], C["params"]>, keyof RequiredOptionKeys<C>>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    // Overload for endpoints WITHOUT required fields (permissive when R is 'any')
    get<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "GET">>> = Prettify<UnionToIntersection<MethodOptions<API, "GET">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends false ? K : never),
        options?: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : FetchRequestOptions<C["body"], C["query"], C["params"]>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    get(path: any, options?: any): Promise<any> {
        return this.request("GET", path, options);
    }

    // Overload for endpoints WITH required fields (body/query/params)
    post<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "POST">>> = Prettify<UnionToIntersection<MethodOptions<API, "POST">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: (IsAnyOrAnyIndexed<R> extends true ? string : never) | (IsAny<API> extends true ? string : never) | (HasRequired<C> extends true ? K : never),
        options: IsAnyOrAnyIndexed<R> extends true ? FetchRequestOptions<any, any, any> : (IsAny<API> extends true
            ? FetchRequestOptions<any, any, any>
            : WithRequired<FetchRequestOptions<C["body"], C["query"], C["params"]>, keyof RequiredOptionKeys<C>>)
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    // Overload for endpoints WITHOUT required fields (permissive when R is 'any')
    post<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "POST">>> = Prettify<UnionToIntersection<MethodOptions<API, "POST">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: (IsAnyOrAnyIndexed<R> extends true ? string : never) | (IsAny<API> extends true ? string : never) | (HasRequired<C> extends false ? K : never),
        options?: IsAnyOrAnyIndexed<R> extends true ? FetchRequestOptions<any, any, any> : (IsAny<API> extends true
            ? FetchRequestOptions<any, any, any>
            : FetchRequestOptions<C["body"], C["query"], C["params"]>)
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    post(path: any, options?: any): Promise<any> {
        return this.request("POST", path, options);
    }

    // Overload for endpoints WITH required fields (body/query/params)
    delete<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "DELETE">>> = Prettify<UnionToIntersection<MethodOptions<API, "DELETE">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends true ? K : never),
        options: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : WithRequired<FetchRequestOptions<C["body"], C["query"], C["params"]>, keyof RequiredOptionKeys<C>>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    // Overload for endpoints WITHOUT required fields (permissive when R is 'any')
    delete<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "DELETE">>> = Prettify<UnionToIntersection<MethodOptions<API, "DELETE">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends false ? K : never),
        options?: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : FetchRequestOptions<C["body"], C["query"], C["params"]>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    delete(path: any, options?: any): Promise<any> {
        return this.request("DELETE", path, options);
    }

    // Overload for endpoints WITH required fields (body/query/params)
    patch<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "PATCH">>> = Prettify<UnionToIntersection<MethodOptions<API, "PATCH">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends true ? K : never),
        options: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : WithRequired<FetchRequestOptions<C["body"], C["query"], C["params"]>, keyof RequiredOptionKeys<C>>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    // Overload for endpoints WITHOUT required fields (permissive when R is 'any')
    patch<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "PATCH">>> = Prettify<UnionToIntersection<MethodOptions<API, "PATCH">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends false ? K : never),
        options?: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : FetchRequestOptions<C["body"], C["query"], C["params"]>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    patch(path: any, options?: any): Promise<any> {
        return this.request("PATCH", path, options);
    }

    // Overload for endpoints WITH required fields (body/query/params)
    put<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "PUT">>> = Prettify<UnionToIntersection<MethodOptions<API, "PUT">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends true ? K : never),
        options: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : WithRequired<FetchRequestOptions<C["body"], C["query"], C["params"]>, keyof RequiredOptionKeys<C>>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    // Overload for endpoints WITHOUT required fields (permissive when R is 'any')
    put<
        API extends InferredAPI<R> = InferredAPI<R>,
        OPT extends Prettify<UnionToIntersection<MethodOptions<API, "PUT">>> = Prettify<UnionToIntersection<MethodOptions<API, "PUT">>>,
        K extends keyof OPT = keyof OPT,
        C extends InferContext<OPT[K]> = InferContext<OPT[K]>
    >(
        path: IsAnyOrAnyIndexed<R> extends true ? string : (HasRequired<C> extends false ? K : never),
        options?: IsAnyOrAnyIndexed<R> extends true
            ? FetchRequestOptions<any, any, any>
            : FetchRequestOptions<C["body"], C["query"], C["params"]>
    ): Promise<
        FetchResponse<InferReturnType<R, OPT, K>>
    >;

    put(path: any, options?: any): Promise<any> {
        return this.request("PUT", path, options);
    }

    protected async executeRequest<M extends HTTPMethod>(
        method: M,
        path: any,
        requestOptions?: any
    ): Promise<any> {
        //
        // FIXME: if FormData is provided, merging "baseOptions.body" with
        // "options.body" will not work as intended
        //
        let body = (this.options.body)
            ? { ...this.options.body, ...(requestOptions?.body as object || {}) }
            : requestOptions?.body;

        const query = (this.options.query)
            ? { ...this.options.query, ...(requestOptions?.query as object || {}) }
            : requestOptions?.query;

        const params = (this.options.params)
            ? { ...this.options.params, ...(requestOptions?.params as object || {}) }
            : requestOptions?.params;

        const headers = new Headers(
            (this.options.headers)
                ? { ...this.options.headers, ...(requestOptions?.headers || {}) }
                : requestOptions?.headers
        );

        // Add Authorization header if authToken is set
        if (this.authToken && !headers.has("authorization")) {
            headers.set("authorization", `Bearer ${this.authToken}`);
        }

        // Stringify JSON-serializable objects for fetch() body
        if (isJSONSerializable(body) && typeof body === 'object' && body !== null) {
            if (!headers.has("content-type")) {
                headers.set("content-type", "application/json");
            }
            for (const [key, value] of Object.entries(body)) {
                if (value instanceof Date) {
                    body[key] = value.toISOString();
                }
            }
            body = JSON.stringify(body);
        }

        const mergedOptions = {
            credentials: requestOptions?.credentials || "include",
            ...this.options,
            ...requestOptions,
            query,
            params,
            headers,
            body,
            method,
        };

        const url = getURLWithQueryParams(this.sdk['getHttpEndpoint'](path.toString()), mergedOptions);

        let raw: Response;
        try {
            raw = await fetch(url, mergedOptions);
        } catch (err: any) {
            // If it's an AbortError, re-throw as-is
            if (err.name === 'AbortError') {
                throw err;
            }
            // Re-throw with network error code at top level (e.g. ECONNREFUSED)
            const networkError: ServerError = new ServerError(err.cause?.code || err.code, err.message);
            networkError.response = raw;
            networkError.cause = err.cause;
            throw networkError;
        }
        const contentType = raw.headers.get("content-type");

        let data: any;

        // TODO: improve content-type detection here!
        if (contentType?.indexOf("json")) {
            data = await raw.json();

        } else if (contentType?.indexOf("text")) {
            data = await raw.text();

        } else {
            data = await raw.blob();
        }

        if (!raw.ok) {
            throw new ServerError(data.code ?? raw.status, data.error ?? data.message ?? raw.statusText, {
                headers: raw.headers,
                status: raw.status,
                response: raw,
                data
            });
        }

        return {
            raw,
            data,
            headers: raw.headers,
            status: raw.status,
            statusText: raw.statusText,
        };
    }
}
