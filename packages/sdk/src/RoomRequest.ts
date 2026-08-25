/** Decoded `Protocol.ROOM_RESPONSE` outcome handed to a pending round-trip's
 *  `onReply` callback: `ok` = resolved, else rejected; `faulted` distinguishes a
 *  server fault (handler threw / no handler) from a deliberate `ctx.reject`. @internal */
export type OnReply = (ok: boolean, payload: any, faulted: boolean) => void;

/** Options for {@link Room.request}. */
export interface RequestOptions {
    /** Reject the returned promise if no reply arrives within this many ms
     *  (defaults to {@link Room.requestTimeout}). */
    timeout?: number;
    /** `"unreliable"` rides the unreliable channel (falls back to reliable when the
     *  transport has none) and is sent once — a genuine drop is surfaced by the
     *  `timeout`. Defaults to `"reliable"`. */
    mode?: "reliable" | "unreliable";
}

/** Build the Error a rejected `request` throws. `faulted:false` → a deliberate
 *  `ctx.reject(reason)`: `name:"rejected"`, `.reason` = the raw typed reason.
 *  `faulted:true` → a server fault: an Error rebuilt from the sanitized
 *  `{ name, message, code }` payload. */
export function toRequestError(payload: any, faulted: boolean): Error {
    if (!faulted) {
        const error: any = new Error("request rejected");
        error.name = "rejected";
        error.reason = payload;
        return error;
    }
    const error: any = new Error(payload?.message ?? "request failed");
    if (payload?.name) { error.name = payload.name; }
    if (payload?.code !== undefined) { error.code = payload.code; }
    return error;
}
