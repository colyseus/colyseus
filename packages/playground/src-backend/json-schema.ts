/**
 * The playground renders forms from JSON Schema, but `onMessage()` and
 * endpoint `body`/`query` accept any Standard Schema validator. Ask the
 * library to describe itself through the Standard JSON Schema interface,
 * falling back to the vendor's own converter for versions that predate it.
 */

// specifier kept dynamic on purpose: these are the user's libraries, absent
// from our own dependency tree
const optional = (name: string) => import(name).catch(() => undefined);

const vendorConverters: Record<string, (schema: any) => Promise<any>> = {
  zod: async (schema) => (await optional('zod'))?.toJSONSchema(schema), // zod < 4.2
  valibot: async (schema) => (await optional('@valibot/to-json-schema'))?.toJsonSchema(schema),
  // effect 3 converts directly; effect 4 upgrades the schema to the interface above
  effect: async (schema) => {
    const effect = await optional('effect');
    return effect?.JSONSchema?.make(schema) ?? toJSONSchema(effect?.Schema?.toStandardJSONSchemaV1(schema));
  },
};

/**
 * Best-effort JSON Schema for a Standard Schema validator.
 *
 * Returns `null` when the validator can't describe itself — the UI falls back
 * to a free-form editor. Never throws: a validator the playground can't
 * introspect must not block a room join.
 */
export async function toJSONSchema(schema: any): Promise<any | null> {
  const standard = schema?.['~standard'];
  if (!standard) { return null; }

  // Standard JSON Schema (@standard-schema/spec 1.1): zod >= 4.2, arktype,
  // effect (via Schema.toStandardJSONSchemaV1()), sury, ...
  try {
    if (standard.jsonSchema) {
      return standard.jsonSchema.input({ target: 'draft-2020-12' });
    }
  } catch (e) { /* target unsupported, or not describable */ }

  try {
    return await vendorConverters[standard.vendor]?.(schema) ?? null;
  } catch (e) { /* converter not installed, or not describable */ }

  return null;
}
