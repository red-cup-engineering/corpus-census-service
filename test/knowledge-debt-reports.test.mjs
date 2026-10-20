import { test } from "node:test";
import assert from "node:assert/strict";
import { censusCorpus } from "../src/corpus-census.mjs";
import {
  deriveKnowledgeDebtReports,
  KNOWLEDGE_DEBT_REPORTS_KIND,
  KNOWLEDGE_LEDGER_ENTERPRISE,
  RATCHET_LAW,
  sectionScopeName,
} from "../src/knowledge-debt-reports.mjs";

const A = "services/a-section";
const OPTIONS = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  date: "2026-10-01",
  directory: "/repository",
  script: "tools/census-corpus.mjs",
  root: "corpus",
  agencyRoot: ".",
  census: "corpus/records/census",
};

function rowsOf(files) {
  const documents = Object.entries(files).map(([path, text], index) => ({
    path, object: String(index).padStart(40, "0"), text,
  }));
  return censusCorpus({
    commit: OPTIONS.commit, date: OPTIONS.date,
    paths: documents.map(({ path }) => path), documents,
  }).rows;
}

const FILES = {
  [`${A}/README.md`]: "# A\n\nSee [gone](gone.md), [lost](lost.md) and [@unheld2021].\n",
  [`${A}/services/c-section/README.md`]: "# C\n\n[[nothing written]]\n",
  "services/b-section/README.md": "# B\n\nSee [a](../a-section/README.md).\n",
  "lib/legacy/old.md": "[[nowhere]] [x](nowhere.md)\n",
};

test("the live debt producer yields original report openings, not obsolete work requests", () => {
  const derived = deriveKnowledgeDebtReports(rowsOf(FILES), OPTIONS);
  assert.equal(derived.kind, KNOWLEDGE_DEBT_REPORTS_KIND);
  assert.equal(derived.poster, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(derived.law, RATCHET_LAW);
  assert.deepEqual(derived.domain.laws, [RATCHET_LAW]);
  assert.deepEqual(derived.openings.map(({ section, total, debt }) => ({ section, total, debt })), [
    { section: A, total: 3, debt: { brokenLinks: 2, unlawfulCitekeys: 1 } },
    { section: `${A}/services/c-section`, total: 1, debt: { unresolvedWikilinks: 1 } },
  ], "each live section owns its own condition; archive and debt-free sections stay out");
  assert.deepEqual([derived.debt, derived.sections, derived.sectionsHoldingNinetyPercent], [4, 2, 2]);

  const [{ opening: report, reread }] = derived.openings;
  assert.equal(report.move, "report");
  assert.equal(report.by, KNOWLEDGE_LEDGER_ENTERPRISE);
  assert.equal(report.law, RATCHET_LAW);
  assert.match(report.subject, /^section:/u);
  assert.ok(report.scope.includes(report.subject), "the report routes to its original owning section");
  assert.ok(report.tags.includes("broken-links"));
  assert.ok(report.tags.includes("unlawful-citekeys"));
  assert.deepEqual(report.evidence, ["corpus/records/census/2026-10-01.json"]);
  assert.equal(report.conditions, undefined, "a measured defect is not a request with self-issued acceptance");
  assert.equal(report.assayer, undefined, "the owner of repair is not assigned by a census");
  assert.equal(report.to, undefined, "no recipient is appointed by the observation");
  assert.match(report.observation, /2 broken links/u);
  assert.match(report.observation, /1 unlawful citekeys/u);
  assert.match(reread, /--section services\/a-section --only --assert brokenLinks<=0 --assert unlawfulCitekeys<=0/u);
});

test("a report holds one law-and-subject thread while evidence and measured counts change", () => {
  const before = deriveKnowledgeDebtReports(rowsOf(FILES), OPTIONS);
  const reduced = rowsOf({
    ...FILES,
    [`${A}/README.md`]: "# A\n\nSee [gone](gone.md) and [@unheld2021].\n",
  });
  const after = deriveKnowledgeDebtReports(reduced, { ...OPTIONS, commit: "f".repeat(40) });
  assert.equal(after.openings[0].debt.brokenLinks, 1);
  assert.equal(after.openings[0].opening.id, before.openings[0].opening.id,
    "identity belongs to the law and subject, not the latest measured amount");
  assert.notEqual(after.openings[0].opening.observation, before.openings[0].opening.observation,
    "the observed evidence must not be frozen to the original count");
  assert.equal(sectionScopeName("services/a-section/apps/b-app"), "a-section/apps/b-app");
  assert.equal(sectionScopeName(""), "root");
  assert.throws(() => deriveKnowledgeDebtReports([], { ...OPTIONS, directory: "relative" }), /absolute/u);
  assert.throws(() => deriveKnowledgeDebtReports([], { ...OPTIONS, agencyRoot: "outside" }),
    /corpus belongs inside the house agency root/u);
});

test("no live violation yields no authored report or synthetic Work obligation", () => {
  const onlyClean = rowsOf({ "services/b-section/README.md": "# B\n\nA self-contained document.\n" });
  const derived = deriveKnowledgeDebtReports(onlyClean, OPTIONS);
  assert.equal(derived.debt, 0);
  assert.equal(derived.sections, 0);
  assert.equal(derived.sectionsHoldingNinetyPercent, 0);
  assert.deepEqual(derived.openings, []);
  assert.equal(derived.kind, KNOWLEDGE_DEBT_REPORTS_KIND);
});
