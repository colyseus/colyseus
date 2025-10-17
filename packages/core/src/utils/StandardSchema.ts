import type { StandardSchemaV1 } from '@standard-schema/spec';
export type { StandardSchemaV1 };

export function standardValidate<T extends StandardSchemaV1>(
    schema: T,
    input: StandardSchemaV1.InferInput<T>
): StandardSchemaV1.InferOutput<T> {
    let result = schema['~standard'].validate(input);

    if (result instanceof Promise) {
        throw new Error('Schema validation must be synchronous');
    }

    // if the `issues` field exists, the validation failed
    if (result.issues) {
        throw new Error(JSON.stringify(result.issues, null, 2));
    }

    return (result as StandardSchemaV1.SuccessResult<StandardSchemaV1.InferOutput<T>>).value;
}