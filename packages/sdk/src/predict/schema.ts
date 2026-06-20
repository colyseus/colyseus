// -----------------------------------------------------------------------------
// Schema-native identity. The decoder assigns every instance a stable integer
// `refId` (own, non-enumerable `Symbol.for("$refId")` property) and exposes a
// field-name → field-index map on `constructor[Symbol.metadata]`. These two
// integers — refId and field index — are the SAME identity the wire protocol
// and any C / C# port use, so Predict keys all of its runtime state on them
// rather than on JS object identity (WeakMap) or field-name strings. The
// instance object and the field-name string never reach the engine's hot path;
// they're resolved to `(refId, fieldId)` once at the API boundary.
// -----------------------------------------------------------------------------

const $REF_ID: symbol = Symbol.for("$refId");
const $METADATA: symbol = (Symbol as { metadata?: symbol }).metadata ?? Symbol.for("Symbol.metadata");
/** Schema's own SoA: a dense array of a decoded instance's field values, indexed
 *  by field index. Reading/writing it bypasses the per-field accessor and the
 *  megamorphic dynamic-key path — reckon's scratch refill + extract use it. */
export const $VALUES: symbol = Symbol.for("$values");

/** Stable integer id the decoder assigned this instance, or undefined if it
 *  hasn't been decoded yet (attach/track called too early — see the Predictor
 *  file header). */
export function refIdOf(instance: object): number | undefined {
    return (instance as Record<symbol, number | undefined>)[$REF_ID];
}

/** The schema metadata object: maps `name -> index` (number) and
 *  `index -> { name, index, type }` (MetadataField). Undefined for non-schema
 *  objects (e.g. plain test fixtures). */
export type SchemaMetadata = Record<string | number, unknown>;
export function metadataOf(instance: object): SchemaMetadata | undefined {
    return (instance.constructor as unknown as Record<symbol, SchemaMetadata | undefined>)[$METADATA];
}

/**
 * Field's declaration index from the schema's metadata, or -1 if unknown.
 * `metadata[name]` is the index. Only used on the COLD attach path (to stamp a
 * slot's SLOT_FIELD and seed reckon sim fields) — the hot `value()` read keys
 * its slot map by field NAME, so it never resolves an index per frame.
 */
export function fieldIndexOf(instance: object, field: string): number {
    const idx = metadataOf(instance)?.[field];
    return typeof idx === "number" ? idx : -1;
}


/** PRIMITIVE (scalar) field names in declaration order, read from the schema
 *  metadata. Empty for non-schema objects. Field indices are dense from 0, so
 *  walk until the first gap.
 *
 *  Only number / string / boolean (and the other primitive encodings — int8,
 *  float32, …) are returned: in the metadata a primitive's `type` is a STRING
 *  ("number", "string", …) whereas a collection (Map/Array/Set) or a nested
 *  Schema carries an OBJECT `type`. The reckon snapshot uses this to clone the
 *  SCALAR state a `step` reads — including string/enum discriminators (`kind`)
 *  and booleans (`grounded`), which steps routinely branch on — while skipping
 *  reference-typed fields. Those are structural, not forward-simulated, and
 *  shallow-copying their reference into a scratch that `step` mutates could
 *  corrupt the live tree; for the rare step that needs one, pass an explicit
 *  `snapshot`. (Schema fields live behind getters over `$values`, so a plain
 *  `{...instance}` spread copies nothing — hence the metadata walk.) */
export function scalarFieldNamesOf(instance: object): string[] {
    const meta = metadataOf(instance);
    if (!meta) return [];
    const names: string[] = [];
    for (let i = 0; ; i++) {
        const f = meta[i] as { name?: string; type?: unknown } | undefined;
        if (!f || typeof f.name !== "string") break;
        if (typeof f.type === "string") names.push(f.name); // skip collections / child schemas (object type)
    }
    return names;
}

/**
 * Build a snapshot fn that clones `fieldNames` from a live instance into a fresh
 * plain object. Used by reckon's GENERIC advance path — schema versions whose
 * decoded instances expose values as own properties / accessors rather than a
 * dense `$values` SoA (e.g. esbuild's class-field transform in the real browser,
 * where the `$values` fast path is unavailable and this is the path production
 * actually runs).
 *
 * Why not a plain `for` loop? A single `o[names[i]] = src[names[i]]` store site
 * sees every field name across one call, so V8 demotes it to
 * `KeyedStoreIC_Megamorphic` — the profiler put ~33% of reckon time there.
 * Unrolling gives each field its OWN store site; with a fixed field layout each
 * site sees exactly one key and stays MONOMORPHIC (no eval; ~2.4× faster
 * snapshot in isolation, ~+19% on the full reckon read). Names are captured as
 * locals so the `!== undefined` guard is a predictable branch. Field sets wider
 * than the unroll fall back to the megamorphic loop (rare — most schemas have
 * < 16 numeric+scalar fields).
 */
const SNAPSHOT_UNROLL_WIDTH = 16;
export function makeUnrolledSnapshot(fieldNames: readonly string[]): (e: any) => any {
    if (fieldNames.length > SNAPSHOT_UNROLL_WIDTH) {
        const names = fieldNames;
        return (e: Record<string, unknown>) => {
            const o: Record<string, unknown> = {};
            for (let i = 0; i < names.length; i++) o[names[i]] = e[names[i]];
            return o;
        };
    }
    const n0 = fieldNames[0], n1 = fieldNames[1], n2 = fieldNames[2], n3 = fieldNames[3],
        n4 = fieldNames[4], n5 = fieldNames[5], n6 = fieldNames[6], n7 = fieldNames[7],
        n8 = fieldNames[8], n9 = fieldNames[9], n10 = fieldNames[10], n11 = fieldNames[11],
        n12 = fieldNames[12], n13 = fieldNames[13], n14 = fieldNames[14], n15 = fieldNames[15];
    return (e: Record<string, unknown>) => {
        const o: Record<string, unknown> = {};
        if (n0 !== undefined) o[n0] = e[n0]; if (n1 !== undefined) o[n1] = e[n1];
        if (n2 !== undefined) o[n2] = e[n2]; if (n3 !== undefined) o[n3] = e[n3];
        if (n4 !== undefined) o[n4] = e[n4]; if (n5 !== undefined) o[n5] = e[n5];
        if (n6 !== undefined) o[n6] = e[n6]; if (n7 !== undefined) o[n7] = e[n7];
        if (n8 !== undefined) o[n8] = e[n8]; if (n9 !== undefined) o[n9] = e[n9];
        if (n10 !== undefined) o[n10] = e[n10]; if (n11 !== undefined) o[n11] = e[n11];
        if (n12 !== undefined) o[n12] = e[n12]; if (n13 !== undefined) o[n13] = e[n13];
        if (n14 !== undefined) o[n14] = e[n14]; if (n15 !== undefined) o[n15] = e[n15];
        return o;
    };
}
