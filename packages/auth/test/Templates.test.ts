import assert from "assert";
import { readTemplate } from "../src/index.ts";

describe("readTemplate", () => {
  it("reads a bundled template", async () => {
    const html = await readTemplate("reset-password-email.html");
    assert.ok(html.length > 0);
    assert.ok(html.includes("[LINK]"), "template should expose the [LINK] placeholder");
  });

  it("falls back to the second template when the first is missing (ENOENT)", async () => {
    const html = await readTemplate(
      "admin-reset-password-email.html", // not bundled
      "reset-password-email.html",
    );
    assert.ok(html.includes("[LINK]"), "should have served the fallback template");
  });

  it("rejects when the template is missing and no fallback is given", async () => {
    await assert.rejects(
      () => readTemplate("definitely-not-a-real-template.html"),
      /ENOENT/,
    );
  });

  it("rejects when both primary and fallback are missing", async () => {
    await assert.rejects(
      () => readTemplate("nope-a.html", "nope-b.html"),
      /ENOENT/,
    );
  });
});
