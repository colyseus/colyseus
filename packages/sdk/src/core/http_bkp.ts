import type { Router, HasRequiredKeys, Prettify, UnionToIntersection, Endpoint, HTTPMethod } from "@colyseus/better-call";

type HasRequired<
	T extends {
		body?: any;
		query?: any;
		params?: any;
	},
> = HasRequiredKeys<T["body"]> extends true
	? true
	: HasRequiredKeys<T["query"]> extends true
		? true
		: HasRequiredKeys<T["params"]> extends true
			? true
            : false;

type InferContext<T> = T extends (ctx: infer Ctx) => any
	? Ctx extends object
		? Ctx
		: never
	: never;

type WithRequired<T, K> = T & {
	[P in K extends string ? K : never]-?: T[P extends keyof T ? P : never];
};

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
> = (undefined extends C["body"]
	? {}
	: {
			body: true;
		}) &
	(undefined extends C["query"]
		? {}
		: {
				query: true;
			}) &
	(undefined extends C["params"]
		? {}
		: {
				params: true;
			});


export interface ClientOptions extends FetchRequestOptions {
	baseURL: string;
}

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
  baseURL?: string;

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

type ResponseData<T> = {
  ok: true;
  data: T;
  error: null,
  response: Response;
  headers: Headers;
  status: number;
  statusText: string;
};

type ResponseError<E> = {
  ok: false,
  data: null,
  error: Prettify<(E extends Record<string, any> ? E : {
    message?: string;
  }) & {
    code?: string;
  }>;
  response: Response;
  headers: Headers;
  status: number;
  statusText: string;
};

type FetchResponse<T, E extends Record<string, unknown> | unknown = unknown, Throw extends boolean = false> =
  Throw extends true
    ? T
    : ResponseData<T> | ResponseError<E>;

// type dd = BetterFetchOption;

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

function getBody(body: any, options?: FetchRequestOptions) {
	if (!body) { return null; }

	const headers = new Headers(options?.headers);
	if (isJSONSerializable(body) && !headers.has("content-type")) {
    options?.headers
		return JSON.stringify(body);
	}

	return body;
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

function getURL(url: string, option?: FetchRequestOptions) {
	let { baseURL, params, query } = option || {
		query: {},
		params: {},
		baseURL: "",
	};
	let basePath = url.startsWith("http")
		? url.split("/").slice(0, 3).join("/")
		: baseURL || "";

	if (!basePath.endsWith("/")) basePath += "/";
	let [path, urlQuery] = url.replace(basePath, "").split("?");
	const queryParams = new URLSearchParams(urlQuery);
	for (const [key, value] of Object.entries(query || {})) {
		if (value == null) continue;
		queryParams.set(key, String(value));
	}
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

	path = path.split("/").map(encodeURIComponent).join("/");
	if (path.startsWith("/")) path = path.slice(1);
	let queryParamString = queryParams.toString();
	queryParamString =
		queryParamString.length > 0 ? `?${queryParamString}`.replace(/\+/g, "%20") : "";
	if (!basePath.startsWith("http")) {
		return `${basePath}${path}${queryParamString}`;
	}
	return new URL(`${path}${queryParamString}`, basePath);
}

export const createClient = <R extends Router | Router["endpoints"]>(baseOptions: ClientOptions) => {
  type API = WithoutServerOnly<
    R extends { endpoints: Record<string, Endpoint> }
      ? R["endpoints"]
      : R
  >;

  function createVerbMethod<M extends HTTPMethod>(method: M) {
    type O = Prettify<UnionToIntersection<MethodOptions<API, M>>>;

    return async <OPT extends O, K extends keyof OPT, C extends InferContext<OPT[K]>>(
      path: K,
      ...options: HasRequired<C> extends true
        ? [
          WithRequired<
            FetchRequestOptions<C["body"], C["query"], C["params"]>,
            keyof RequiredOptionKeys<C>
          >,
        ]
        : [FetchRequestOptions<C["body"], C["query"], C["params"]>?]
    ): Promise<
      FetchResponse<Awaited<ReturnType<OPT[K] extends Endpoint ? OPT[K] : never>>>
    > => {
      //
      // FIXME: if FormData is provided, merging "baseOptions.body" with
      // "options.body" will not work as intended
      //
      let body = (baseOptions.body)
        ? { ...baseOptions.body, ...(options[0]?.body as object || {}) }
        : options[0]?.body;

      const query = (baseOptions.query)
        ? { ...baseOptions.query, ...(options[0]?.query as object || {}) }
        : options[0]?.query;

      const params = (baseOptions.params)
        ? { ...baseOptions.params, ...(options[0]?.params as object || {}) }
        : options[0]?.params;

      const headers = new Headers(
        (baseOptions.headers)
          ? { ...baseOptions.headers, ...(options[0]?.headers || {}) }
          : options[0]?.headers
      );

      if (isJSONSerializable(body) && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
        for (const [key, value] of Object.entries(body)) {
          if (value instanceof Date) {
            body[key] = value.toISOString();
          }
        }
        body = JSON.stringify(body);
      }

      const mergedOptions = {
        credentials: options[0]?.credentials || "include",
        ...baseOptions,
        ...options[0],
        query,
        params,
        headers,
        body,
        method,
      };

      mergedOptions.body = getBody(body, mergedOptions);

      const url = getURL(path.toString(), mergedOptions);

      const response = await fetch(url, mergedOptions);
      const contentType = response.headers.get("content-type");

      let data: any;
      let error = null;

      // TODO: improve content-type detection here!
      if (contentType?.indexOf("json")) {
        data = await response.json();

      } else if (contentType?.indexOf("text")) {
        data = await response.text();

      } else {
        data = await response.blob();
      }

      if (!response.ok) {
        // TODO: throw error here?!
        error = data;
        data = null;
      }

      return {
        ok: response.ok,
        headers: response.headers,
        data,
        error,
        status: response.status,
        statusText: response.statusText,
        response,
      } as any;
    };
  };

  return {
    get: createVerbMethod("GET"),
    post: createVerbMethod("POST"),
    delete: createVerbMethod("DELETE"),
    patch: createVerbMethod("PATCH"),
    put: createVerbMethod("PUT"),
  };
};
