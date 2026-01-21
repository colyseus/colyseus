
export class ServerError<DATA=any> extends Error {
    public code: number;

    public headers?: Headers;
    public status?: number;
    public response?: Response;
    public data?: DATA;

    constructor(code: number, message: string, opts?: { headers?: Headers, status?: number, response?: Response, data?: any }) {
        super(message);

        this.name = "ServerError";
        this.code = code;

        if (opts) {
            this.headers = opts.headers;
            this.status = opts.status;
            this.response = opts.response;
            this.data = opts.data;
        }
    }
}

export class AbortError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AbortError";
    }
}

export class MatchMakeError extends Error {
    public code: number;
    constructor(message: string, code: number) {
        super(message);
        this.code = code;
        this.name = "MatchMakeError";
        Object.setPrototypeOf(this, MatchMakeError.prototype);
    }
}