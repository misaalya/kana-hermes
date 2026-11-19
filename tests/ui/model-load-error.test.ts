import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NonJsonResponseError, RequestTimeoutError } from "@/lib/runtime/read-json-response";
import { getCopy } from "@/lib/ui/copy";
import { describeModelLoadError } from "@/lib/ui/model-load-error";

describe("describeModelLoadError", () => {
  const id = getCopy("id").settings;
  const en = getCopy("en").settings;

  it("names a proxy timeout and keeps its status", () => {
    const problem = describeModelLoadError("id", new NonJsonResponseError(524));
    assert.equal(problem.detail, id.modelLoadTimeout);
    assert.equal(problem.hint, id.modelLoadTimeoutHint);
    assert.equal(problem.status, 524);
  });

  it("tells a restarting server apart from a stale page", () => {
    assert.equal(describeModelLoadError("en", new NonJsonResponseError(502)).detail, en.modelLoadUnreachable);
    assert.equal(describeModelLoadError("en", new NonJsonResponseError(200)).detail, en.modelLoadPage);
  });

  it("explains a browser timeout and a network failure", () => {
    assert.equal(
      describeModelLoadError("id", new RequestTimeoutError("Hermes request timed out: model.options")).detail,
      id.modelLoadSlow,
    );
    assert.equal(describeModelLoadError("id", new TypeError("Failed to fetch")).detail, id.modelLoadOffline);
  });

  it("shows an error Kana or Hermes wrote itself as written", () => {
    const problem = describeModelLoadError("en", new Error("Provider key rejected."));
    assert.equal(problem.detail, "Provider key rejected.");
    assert.equal(problem.hint, "");
    assert.equal(describeModelLoadError("en", null).detail, en.modelLoadFailed);
  });
});
