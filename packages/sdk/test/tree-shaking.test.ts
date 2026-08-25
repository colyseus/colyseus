import { describe, test } from "vitest";
import { assert } from "chai";
import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

//
// The prediction tooling is re-exported from the top-level barrel for the
// convenience `import { Predict } from "@colyseus/sdk"` form. That's only
// acceptable while it stays free for apps that don't use it — a single
// top-level side effect anywhere under `src/predict/` would start billing
// every consumer for ~16KB gzip they never asked for.
//
// Asserted on rollup's retained-module map rather than on the emitted text:
// identifier greps break under minification, and the core input machinery
// mentions "reconciler"/"rollback" in its own comments.
//

const SDK_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREDICT_BARREL = path.join(SDK_ROOT, "src", "predict.ts");
const PREDICT_DIR = path.join(SDK_ROOT, "src", "predict") + path.sep;

const isPredictModule = (id: string) => id === PREDICT_BARREL || id.startsWith(PREDICT_DIR);
const rel = (id: string) => path.relative(SDK_ROOT, id);

/**
 * Bundle a fixture through vite (production mode, so rollup tree-shakes) and
 * return the module ids rollup actually kept, mapped to their rendered byte
 * length. Tree-shaken modules either drop out of the map entirely or survive
 * with a length of 0, so callers filter on `> 0`.
 */
async function retainedModules(fixture: string): Promise<Record<string, number>> {
    const result = await build({
        root: SDK_ROOT,
        configFile: false,
        logLevel: "silent",
        build: {
            write: false,
            minify: false,
            target: "esnext",
            lib: {
                entry: path.join(SDK_ROOT, "test", "fixtures", fixture),
                formats: ["es"],
                fileName: "bundle",
            },
        },
    });

    const output = (Array.isArray(result) ? result[0] : result as any).output;
    const chunk = output.find((o: any) => o.type === "chunk");
    assert.isDefined(chunk, `no chunk emitted for ${fixture}`);

    const retained: Record<string, number> = {};
    for (const [id, info] of Object.entries<any>(chunk.modules)) {
        retained[id] = info.renderedLength;
    }
    return retained;
}

describe("tree-shaking", () => {

    test("a Predict-free app bundle retains no prediction module", async () => {
        const retained = await retainedModules("treeshake-base.ts");

        // Guard against a vacuous pass (bad resolution, empty bundle).
        const kept = Object.entries(retained).filter(([, len]) => len > 0).map(([id]) => id);
        assert.isTrue(
            kept.some((id) => id === path.join(SDK_ROOT, "src", "Room.ts")),
            `expected src/Room.ts in the bundle, got:\n${kept.map(rel).join("\n")}`,
        );

        const leaked = kept.filter(isPredictModule);
        assert.deepEqual(
            leaked.map(rel), [],
            "prediction modules leaked into a bundle that never imports Predict — " +
            "check for a new top-level side effect under src/predict/, or a core " +
            "module importing from it (schema reflection belongs in " +
            "src/core/schema-reflect.ts, not src/predict/)",
        );
    }, 120_000);

    test("importing Predict does pull the prediction modules in", async () => {
        const retained = await retainedModules("treeshake-predict.ts");
        const kept = Object.entries(retained).filter(([, len]) => len > 0).map(([id]) => id);

        assert.isTrue(
            kept.filter(isPredictModule).length > 0,
            "positive control failed: Predict was imported but no prediction module " +
            "was retained — the id matching in this test is probably stale",
        );
    }, 120_000);

});
