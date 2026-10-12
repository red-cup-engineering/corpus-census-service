import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStructuredWorkIntent } from "@red-cup-engineering/feltos/work/structured-intent";
import { censusCorpus } from "../src/corpus-census.mjs";
import { signalBoard } from "@red-cup-engineering/organizing/enterprise";
import { deriveKnowledgeWorkSignals, KNOWLEDGE_LEDGER_ENTERPRISE, reconcileKnowledgeSignals, sectionScopeName } from "../src/knowledge-work-signals.mjs";

const A = "services/a-section";
const OPTIONS = { commit: "0123456789abcdef0123456789abcdef01234567", date: "2026-10-01", directory: "/repository", script: "tools/census-corpus.mjs", root: "corpus", census: "corpus/records/census" };

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

test("each live section carrying ratchet debt is one open signal, largest debt first", () => {
  const derived = deriveKnowledgeWorkSignals(rowsOf(FILES), OPTIONS);
  assert.deepEqual(derived.signals.map(({ section, total, debt }) => ({ section, total, debt })), [
    { section: A, total: 3, debt: { brokenLinks: 2, unlawfulCitekeys: 1 } },
    { section: `${A}/services/c-section`, total: 1, debt: { unresolvedWikilinks: 1 } },
  ], "a section's own carriers only; the archive stratum and debt-free sections post nothing");
  assert.deepEqual([derived.debt, derived.sections, derived.sectionsHoldingNinetyPercent], [4, 2, 2]);

  const [{ signal }] = derived.signals;
  assert.equal(signal.poster, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(signal.assayer, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(signal.to, undefined, "open to any micro-enterprise whose policy takes it; nobody assigns it");
  assert.deepEqual(signal.tags, ["broken-links", "knowledge-debt", `section:${A}`, "unlawful-citekeys"]);
  assert.match(signal.id, /\S/u, "a signal of the board's own algebra, content-addressed");
  const intent = assertStructuredWorkIntent(signal.intent);
  const items = intent.items.filter((item) => item.cell.startsWith("work-item:"));
  assert.deepEqual(items.map(({ cell, conflicts, work }) => ({ cell, conflicts, work })), [
    { cell: "work-item:knowledge-debt/a-section/broken-links", conflicts: ["work-item:knowledge-debt/a-section/unlawful-citekeys"], work: "link-repair" },
    { cell: "work-item:knowledge-debt/a-section/unlawful-citekeys", conflicts: ["work-item:knowledge-debt/a-section/broken-links"], work: "lawful-depth-1-citation" },
  ], "debts within one section share its write set, so they conflict");
  assert.deepEqual(items[0].deterministicExecution, {
    operation: "census-corpus",
    request: { type: "JavascriptNodeCommandExecutionRequest", version: 1, command: "node", arguments: ["tools/census-corpus.mjs", "--root", "corpus", "--section", A, "--only", "--assert", "brokenLinks<=0"], directory: "/repository", environment: null, input: null },
    acceptance: { kind: "command-exit-status", status: 0 },
  });
});

test("a signal names what it asks, not what was counted, so it is the same signal while the debt persists", () => {
  const before = deriveKnowledgeWorkSignals(rowsOf(FILES), OPTIONS);
  const after = deriveKnowledgeWorkSignals(rowsOf({ ...FILES, [`${A}/README.md`]: "# A\n\nSee [gone](gone.md) and [@unheld2021].\n" }), { ...OPTIONS, commit: "f".repeat(40) });
  assert.equal(after.signals[0].debt.brokenLinks, 1);
  assert.deepEqual(after.signals[0].signal, before.signals[0].signal);
  assert.equal(sectionScopeName("services/a-section/apps/b-app"), "a-section/apps/b-app");
  assert.equal(sectionScopeName(""), "root");
  assert.throws(() => deriveKnowledgeWorkSignals([], { ...OPTIONS, directory: "relative" }), /absolute/u);
});

test("the ledger reconciles its standing: posts new demand, accepts resulted repairs, withdraws the rest", () => {
  const before = deriveKnowledgeWorkSignals(rowsOf(FILES), OPTIONS);
  const [a, c] = before.signals.map((entry) => entry.signal);
  const at = "2026-10-02T00:00:00.000Z";
  assert.deepEqual(reconcileKnowledgeSignals([], before).post.map((signal) => signal.id), [a.id, c.id]);

  const foreign = { ...a, id: "elsewhere", poster: "another-enterprise" };
  const board = signalBoard({
    signal: [a, c, foreign],
    take: [{ signal: c.id, enterprise: "c-section", subject: "work", at }],
    result: [{ signal: c.id, enterprise: "c-section", evidence: [], at }],
  }, at);
  const repaired = deriveKnowledgeWorkSignals(rowsOf({ ...FILES, [`${A}/services/c-section/README.md`]: "# C\n", [`${A}/README.md`]: "# A\n\nSee [gone](gone.md).\n" }), OPTIONS);
  const plan = reconcileKnowledgeSignals(board, repaired);
  assert.equal(plan.post.length, 1, "A's remaining debt asks something new: one item, not two");
  assert.notEqual(plan.post[0].id, a.id);
  assert.deepEqual(plan.accept, [{ signal: c.id, enterprise: "c-section" }]);
  assert.deepEqual(plan.withdraw, [{ signal: a.id, reason: "the ledger no longer measures this debt" }]);
  assert.deepEqual(reconcileKnowledgeSignals(board, before), { post: [], accept: [], withdraw: [] }, "deriving again while nothing changed does nothing");
});
