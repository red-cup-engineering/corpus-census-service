import { test } from "node:test";
import assert from "node:assert/strict";
import { censusCorpus } from "../src/corpus-census.mjs";
import { checkLedgerAssertions, inScheme, measureScheme, parseLedgerAssertion, ratchetCorpus } from "../src/corpus-ledger.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const A = "services/a-section";
const B = "services/b-section";

function rowsOf(files) {
  const documents = Object.entries(files).map(([path, text], index) => ({ path, object: String(index).padStart(40, "0"), text }));
  return censusCorpus({ commit: COMMIT, date: "2026-10-01", paths: documents.map(({ path }) => path), documents }).rows;
}

const BASE = {
  [`${A}/README.md`]: "# A\n\nSee [b](../b-section/README.md) and [gone](gone.md).\n",
  [`${A}/services/c-section/README.md`]: "# C\n\nCites [@kept2020].\n",
  [`${B}/README.md`]: "# B\n\nSee [a](../a-section/README.md).\n",
  "lib/legacy/old.md": "[[nowhere]] [x](nowhere.md)\n",
};

test("assertions read <measure><op><n> over the ledger's measures", () => {
  assert.deepEqual(parseLedgerAssertion("brokenLinks<=0"), { measure: "brokenLinks", op: "<=", value: 0, text: "brokenLinks<=0" });
  assert.equal(parseLedgerAssertion(" unschematized >= 12 ").text, "unschematized>=12");
  assert.throws(() => parseLedgerAssertion("brokenLinks<=-1"), TypeError);
  assert.throws(() => parseLedgerAssertion("debt<=0"), /not a ledger measure/u);
  assert.equal(inScheme(`${A}/services/c-section`, A), true);
  assert.equal(inScheme("services/a-section-two", A), false);
  assert.equal(inScheme(B, ""), true);
});

test("a scheme's measures sum its live rows and every section under it", () => {
  const rows = rowsOf(BASE);
  const measures = measureScheme(rows, A);
  assert.equal(measures.carriers, 2);
  assert.equal(measures.brokenLinks, 1);
  assert.equal(measures.unlawfulCitekeys, 1);
  assert.equal(measureScheme(rows).carriers, 3, "the archive stratum is not measured");
  assert.deepEqual([measureScheme(rows, A, { only: true }).carriers, measureScheme(rows, A, { only: true }).unlawfulCitekeys], [1, 0], "only the scheme's own carriers");
  assert.equal(inScheme(`${A}/services/c-section`, A, true), false);
  assert.deepEqual(checkLedgerAssertions(measures, ["brokenLinks<=0", "carriers=2"].map(parseLedgerAssertion)), [
    { assertion: "brokenLinks<=0", measured: 1, holds: false },
    { assertion: "carriers=2", measured: 2, holds: true },
  ]);
});

test("the ratchet refuses new debt in any section and admits repair", () => {
  const base = rowsOf(BASE);
  const damaged = ratchetCorpus(base, rowsOf({ ...BASE, [`${B}/README.md`]: "# B\n\nSee [a](../a-section/README.md) and [lost](lost.md).\n" }));
  assert.equal(damaged.holds, false);
  assert.deepEqual(damaged.rises, [{ section: B, measure: "brokenLinks", base: 0, candidate: 1 }]);
  const repaired = ratchetCorpus(base, rowsOf({ ...BASE, [`${A}/README.md`]: "# A\n\nSee [b](../b-section/README.md).\n" }));
  assert.equal(repaired.holds, true);
  assert.deepEqual(repaired.falls, [{ section: A, measure: "brokenLinks", base: 1, candidate: 0 }]);
  const elsewhere = ratchetCorpus(base, rowsOf({ ...BASE, [`${A}/README.md`]: "# A\n\nSee [b](../b-section/README.md).\n", [`${B}/README.md`]: "# B\n\n[lost](lost.md)\n" }));
  assert.equal(elsewhere.holds, false, "repair in one section does not pay for damage in another");
  const { [`${B}/README.md`]: _removed, ...withoutB } = BASE;
  const deleted = ratchetCorpus(base, rowsOf(withoutB));
  assert.deepEqual(deleted.rises, [{ section: A, measure: "brokenLinks", base: 1, candidate: 2 }], "deleting a linked carrier damages the section linking to it");
  assert.equal(ratchetCorpus(base, rowsOf({ ...BASE, "lib/legacy/old.md": "[[still nowhere]] [[and more]]\n" })).holds, true, "the archive stratum carries no ratchet");
  assert.deepEqual(ratchetCorpus(base, rowsOf(BASE), { scheme: B }).rises, []);
});

test("a moved carrier carries its debt back to the section it left", () => {
  const text = "# C\n\nCites [@kept2020].\n";
  const base = rowsOf(BASE);
  const { [`${A}/services/c-section/README.md`]: _moved, ...rest } = BASE;
  const moved = ratchetCorpus(base, rowsOf({ ...rest, [`${B}/services/c-section/README.md`]: text }));
  assert.equal(moved.holds, true);
  assert.equal(moved.moves, 1);
  const worse = ratchetCorpus(base, rowsOf({ ...rest, [`${B}/services/c-section/README.md`]: `${text}Also [@unheld2021].\n` }));
  assert.deepEqual(worse.rises, [{ section: `${A}/services/c-section`, measure: "unlawfulCitekeys", base: 1, candidate: 2 }], "a move that adds debt is refused where it came from");
});
