/**
 * Minimal fetch-compatible wrapper around XMLHttpRequest.
 * Used as an automatic fallback when globalThis.fetch is unavailable
 * (e.g. Cocos Creator Native).
 */
export function xhrFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const method = init?.method || "GET";

        xhr.open(method, url.toString());
        xhr.withCredentials = (init?.credentials === "include");

        // Apply request headers
        if (init?.headers) {
            const headers = (init.headers instanceof Headers)
                ? init.headers
                : new Headers(init.headers as HeadersInit);
            headers.forEach((value, key) => {
                xhr.setRequestHeader(key, value);
            });
        }

        xhr.onload = () => {
            // Parse response headers
            const headers = new Headers();
            const rawHeaders = xhr.getAllResponseHeaders().trim();
            if (rawHeaders) {
                for (const line of rawHeaders.split(/[\r\n]+/)) {
                    const idx = line.indexOf(": ");
                    if (idx > 0) {
                        headers.append(line.substring(0, idx), line.substring(idx + 2));
                    }
                }
            }

            const responseBody = xhr.response ?? xhr.responseText;

            resolve(new XHRResponse(responseBody, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers,
            }) as unknown as Response);
        };

        xhr.onerror = () => reject(new TypeError("Network request failed"));
        xhr.ontimeout = () => reject(new TypeError("Network request timed out"));

        xhr.send(init?.body as XMLHttpRequestBodyInit | null ?? null);
    });
}

/**
 * Minimal Response-compatible class backed by XHR response data.
 * Implements only the surface used by HTTP.executeRequest().
 */
class XHRResponse {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly ok: boolean;

    private body: any;

    constructor(body: any, init: { status: number; statusText: string; headers: Headers }) {
        this.body = body;
        this.status = init.status;
        this.statusText = init.statusText;
        this.headers = init.headers;
        this.ok = init.status >= 200 && init.status < 300;
    }

    async json(): Promise<any> {
        return typeof this.body === "string"
            ? JSON.parse(this.body)
            : this.body;
    }

    async text(): Promise<string> {
        return typeof this.body === "string"
            ? this.body
            : JSON.stringify(this.body);
    }

    async blob(): Promise<Blob> {
        return new Blob([this.body]);
    }
}
