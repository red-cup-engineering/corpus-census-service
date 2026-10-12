import { test } from "node:test";
import assert from "node:assert/strict";
import { censusCorpus } from "../src/corpus-census.mjs";
import { reconcileDerivedOpenings, workBoard } from "@red-cup-engineering/organizing/enterprise";
import { deriveKnowledgeWorkRequests, KNOWLEDGE_LEDGER_ENTERPRISE, sectionScopeName } from "../src/knowledge-work-requests.mjs";

const A = "services/a-section";
const OPTIONS = { commit: "0123456789abcdef0123456789abcdef01234567", date: "2026-10-01", directory: "/repository", script: "tools/census-corpus.mjs", root: "corpus", agencyRoot: ".", census: "corpus/records/census" };

function rowsOf(files) {
  const documents = Object.entries(files).map(([path, text], index) => ({ path, object: String(index).padStart(40, "0"), text }));
  return censusCorpus({ commit: OPTIONS.commit, date: OPTIONS.date, paths: documents.map(({ path }) => path), documents }).rows;
}

const FILES = {
  [`${A}/README.md`]: "# A\n\nSee [gone](gone.md), [lost](lost.md) and [@unheld2021].\n",
  [`${A}/services/c-section/README.md`]: "# C\n\n[[nothing written]]\n",
  "services/b-section/README.md": "# B\n\nSee [a](../a-section/README.md).\n",
  "lib/legacy/old.md": "[[nowhere]] [x](nowhere.md)\n",
};

test("each live section carrying ratchet debt is one open request, largest debt first", () => {
  const derived = deriveKnowledgeWorkRequests(rowsOf(FILES), OPTIONS);
  assert.deepEqual(derived.openings.map(({ section, total, debt }) => ({ section, total, debt })), [
    { section: A, total: 3, debt: { brokenLinks: 2, unlawfulCitekeys: 1 } },
    { section: `${A}/services/c-section`, total: 1, debt: { unresolvedWikilinks: 1 } },
  ], "a section's own carriers only; the archive stratum and debt-free sections open nothing");
  assert.deepEqual([derived.debt, derived.sections, derived.sectionsHoldingNinetyPercent], [4, 2, 2]);

  const [{ opening: request }] = derived.openings;
  assert.equal(request.move, "request");
  assert.equal(request.by, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(request.assayer, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(request.to, undefined, "open to any micro-enterprise whose policy takes it; nobody assigns it");
  assert.deepEqual(request.tags, ["broken-links", "knowledge-debt", `section:corpus/${A}`, "unlawful-citekeys"]);
  assert.deepEqual(request.conditions.map((condition) => condition.id), ["broken-links", "unlawful-citekeys"], "one condition of satisfaction per debt");
  assert.deepEqual(request.conditions[0].assay, {
    operation: "census-corpus",
    request: { type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "node", arguments: ["tools/census-corpus.mjs", "--root", "corpus", "--section", A, "--only", "--assert", "brokenLinks<=0"], directory: "/repository", environment: null, input: null },
    acceptance: { kind: "command-exit-status", status: 0 },
  });
  assert.equal(request.plan, undefined, "the assayer states the desired effect; its checks are not a repair method");
});

test("a request names what it asks, not what was counted, so it is the same request while the debt persists", () => {
  const before = deriveKnowledgeWorkRequests(rowsOf(FILES), OPTIONS);
  const after = deriveKnowledgeWorkRequests(rowsOf({ ...FILES, [`${A}/README.md`]: "# A\n\nSee [gone](gone.md) and [@unheld2021].\n" }), { ...OPTIONS, commit: "f".repeat(40) });
  assert.equal(after.openings[0].debt.brokenLinks, 1);
  assert.deepEqual(after.openings[0].opening, before.openings[0].opening);
  assert.equal(sectionScopeName("services/a-section/apps/b-app"), "a-section/apps/b-app");
  assert.equal(sectionScopeName(""), "root");
  assert.throws(() => deriveKnowledgeWorkRequests([], { ...OPTIONS, directory: "relative" }), /absolute/u);
});

test("the ledger reconciles its standing: opens new requests, accepts delivered repairs, withdraws the rest", () => {
  const before = deriveKnowledgeWorkRequests(rowsOf(FILES), OPTIONS);
  const [a, c] = before.openings.map((entry) => entry.opening);
  const at = "2026-10-02T00:00:00.000Z";
  const reconcile = (board, derivation) => reconcileDerivedOpenings(board, { poster: derivation.poster, openings: derivation.openings.map((entry) => entry.opening) });
  assert.deepEqual(reconcile(workBoard([], at), before).open.map((request) => request.id), [a.id, c.id]);

  const foreign = { ...a, id: "elsewhere", by: "another-enterprise" };
  const board = workBoard([
    a, c, foreign,
    { move: "promise", thread: c.id, by: "c-section", subject: "work", at },
    { move: "deliver", thread: c.id, by: "c-section", evidence: ["commit:abc"], at },
  ], at);
  const repaired = deriveKnowledgeWorkRequests(rowsOf({ ...FILES, [`${A}/services/c-section/README.md`]: "# C\n", [`${A}/README.md`]: "# A\n\nSee [gone](gone.md).\n" }), { ...OPTIONS, previous: before });
  const plan = reconcile(board, repaired);
  assert.equal(plan.open.length, 1, "A's remaining debt asks something new: one condition, not two");
  assert.notEqual(plan.open[0].id, a.id);
  assert.deepEqual(plan.open[0].supersedes, [a.id], "a revised contract is not evidence that the old conditions were satisfied");
  assert.deepEqual(plan.settle, [
    { move: "accept", thread: c.id, of: "c-section", by: KNOWLEDGE_LEDGER_ENTERPRISE },
  ]);
  assert.deepEqual(reconcile(board, before), { open: [], settle: [] }, "deriving again while nothing changed does nothing");
});
