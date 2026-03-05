import * as assert from "assert";
import { buildRemoteRowPredicate } from "../../sqlite/SqliteVisualEditor";

describe("SQLite Remote Row Predicate", () => {
  it("returns undefined when no row identity is available", () => {
    assert.strictEqual(buildRemoteRowPredicate(undefined), undefined);
    assert.strictEqual(buildRemoteRowPredicate({}), undefined);
  });

  it("builds deterministic predicates using PRIMARY KEY identity values", () => {
    const predicate = buildRemoteRowPredicate({
      tenant_id: "acme",
      id: 42,
      deleted_at: null,
    });

    assert.strictEqual(
      predicate,
      "\"deleted_at\" IS NULL AND \"id\" = 42 AND \"tenant_id\" = 'acme'"
    );
  });

  it("escapes identifiers and string values safely", () => {
    const predicate = buildRemoteRowPredicate({
      "quote\"column": "O'Brien",
    });

    assert.strictEqual(predicate, "\"quote\"\"column\" = 'O''Brien'");
  });
});
