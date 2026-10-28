import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assaySourceCustody, SOURCE_CUT_KIND, SOURCE_CUSTODY_ASSAY_KIND } from "../src/source-custody.mjs";

const sha = character => character.repeat(40);
const cut = (repository, entries, prefix = "") => ({ kind: SOURCE_CUT_KIND, repository,
  revision: sha("f"), prefix, coverage: "complete",
  entries: entries.map(([path, blob]) => ({ path, blob })) });
const make = () => ({
  original: cut("emsenn/research-content", [
    ["predication-locution-illocution-perlocution-factorization.md", sha("a")],
    ["predication-klein-four-stratifies-locution-illocution-perlocution.md", sha("b")],
    ["predication-state-of-the-theory.md", sha("c")],
    ["predication-untaken.md", sha("d")],
  ], "_archive/from-predicate-category"),
  legacy: cut("emsenn/561-group", [
    ["predication-locution-illocution-perlocution-factorization.md", sha("a")],
    ["predication-klein-four-stratifies-locution-illocution-perlocution.md", sha("b")],
    ["predication-state-of-the-theory.md", sha("e")],
    ["predication-tangent-dimension.md", sha("6")],
  ], "lib/legacy/from-predicate-category"),
  canonical: cut("lenticule-science/561-theory-science-services-section", [
    ["prose/learning/claims/klein-four-stratifies-locution-illocution-perlocution.md", sha("b")],
    ["prose/learning/claims/locution-illocution-perlocution-factorization.md", sha("a")],
  ], "humanities/theories/math/theories/categories/theories/predication-categories"),
});

test("SHA-qualified speech-act manuscripts map to exactly one original Science home", () => {
  const result = assaySourceCustody(make());
  assert.equal(result.kind, SOURCE_CUSTODY_ASSAY_KIND);
  assert.equal(result.counts.exactThreeWay, 2);
  assert.equal(result.counts.differentHistoricalBytes, 1);
  assert.equal(result.counts.originalOnly, 1);
  assert.equal(result.counts.legacyOnly, 1);
  assert.equal(result.counts.noCanonicalBlob, 2);
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0].canonicalStatus, "unique-byte-peer");
  assert.equal(result.rows[0].legacyCanonicalStatus, "unique-byte-peer");
  assert.equal(result.counts.divergentNoSingleExact, 1);
  assert.equal(result.rows[0].canonicalPaths[0], "prose/learning/claims/klein-four-stratifies-locution-illocution-perlocution.md");
  assert.match(result.authority, /no-content-grant/);
  assert.ok(result.sources.every(entry => entry.coverage === "complete"));
});

test("the assay is deterministic under input order permutations", () => {
  const a = make();
  const b = make();
  for (const value of [b.original, b.legacy, b.canonical]) value.entries.reverse();
  assert.deepEqual(assaySourceCustody(a), assaySourceCustody(b));
});

test("equal archive bytes without a canonical mathematical home are not considered received", () => {
  const input = make();
  input.canonical.entries = [];
  const result = assaySourceCustody(input);
  assert.equal(result.counts.exactThreeWay, 0);
  assert.equal(result.counts.equalHistoricalOnly, 2);
  assert.equal(result.rows.find(row => row.path.startsWith("predication-locution-illocution")).canonicalStatus, "unobserved");
});

test("two Science homes sharing exact bytes remain ambiguous rather than a unique Thing", () => {
  const input = make();
  input.canonical.entries.push(["duplicate/term.md", sha("a")]);
  input.canonical.entries = input.canonical.entries.map(entry => Array.isArray(entry) ? { path: entry[0], blob: entry[1] } : entry);
  const result = assaySourceCustody(input);
  assert.equal(result.counts.exactThreeWay, 1);
  assert.equal(result.counts.ambiguousCanonical, 1);
  assert.equal(result.rows.find(row => row.path.startsWith("predication-locution-illocution")).canonicalStatus, "ambiguous-byte-peers");
});

test("incomplete, forged, repeated or unsafe source cuts refuse without inferring absence", () => {
  const edits = [
    x => { x.original.coverage = "partial"; },
    x => { x.original.revision = "main"; },
    x => { x.original.entries[0].blob = "not-a-sha"; },
    x => { x.original.entries[0].path = "../outside.md"; },
    x => { x.original.entries[0].path = "/outside.md"; },
    x => { x.original.entries.push({ ...x.original.entries[0] }); },
    x => { x.original.entries[0].bytes = -1; },
    x => { x.original.repository = x.legacy.repository; },
    x => { x.canonical.entries = null; },
    x => { x.canonical.authority = "all"; },
    x => { x.legacy.entries[0].grant = "allow"; },
    x => { x.extraRegistry = "fabricated"; },
  ];
  for (const edit of edits) {
    const data = make(); edit(data);
    assert.throws(() => assaySourceCustody(data), TypeError);
  }
});


test("divergent historical copies retain both independent Science byte readings", () => {
  const original = make();
  // In the original corpus c != e. The original has no canonical peer; the
  // nonidentical legacy e DOES have a current Science byte peer.
  original.canonical.entries.push({ path: "prose/surveys/legacy-reading.md", blob: sha("e") });
  const result = assaySourceCustody(original);
  const row = result.rows.find(item => item.path === "predication-state-of-the-theory.md");
  assert.equal(row.relation, "different-historical-bytes");
  assert.deepEqual(row.canonicalPaths, []);
  assert.deepEqual(row.legacyCanonicalPaths, ["prose/surveys/legacy-reading.md"]);
  assert.equal(row.legacyCanonicalStatus, "unique-byte-peer");
  assert.equal(result.counts.divergentLegacyExactOnly, 1);
  assert.equal(result.counts.divergentNoSingleExact, 0);
});

test("two different versions may each have a distinct canonical home, without being collapsed", () => {
  const x = make();
  x.canonical.entries.push({ path: "prose/surveys/original-reading.md", blob: sha("c") });
  x.canonical.entries.push({ path: "prose/surveys/legacy-reading.md", blob: sha("e") });
  const got = assaySourceCustody(x);
  const row = got.rows.find(item => item.path === "predication-state-of-the-theory.md");
  assert.deepEqual(row.canonicalPaths, ["prose/surveys/original-reading.md"]);
  assert.deepEqual(row.legacyCanonicalPaths, ["prose/surveys/legacy-reading.md"]);
  assert.equal(got.counts.divergentBothExact, 1);
  assert.equal(row.relation, "different-historical-bytes");
});

test("duplicate canonical bytes remain ambiguous for the legacy variant", () => {
  const x = make();
  x.canonical.entries.push({ path: "x/e.md", blob: sha("e") });
  x.canonical.entries.push({ path: "y/e.md", blob: sha("e") });
  const got = assaySourceCustody(x);
  const row = got.rows.find(item => item.path === "predication-state-of-the-theory.md");
  assert.equal(row.legacyCanonicalStatus, "ambiguous-byte-peers");
  assert.equal(got.counts.divergentNoSingleExact, 1);
  assert.equal(got.counts.divergentLegacyExactOnly, 0);
});

test("the bounded native CLI reads one complete snapshot and refuses malformed source", () => {
  const script = fileURLToPath(new URL("../scripts/assay-source-custody.mjs", import.meta.url));
  const passed = spawnSync(process.execPath, [script], { input: JSON.stringify(make()), encoding: "utf8" });
  assert.equal(passed.status, 0, passed.stderr);
  assert.deepEqual(JSON.parse(passed.stdout), assaySourceCustody(make()));
  const bad = make(); bad.legacy.coverage = "partial";
  const refused = spawnSync(process.execPath, [script], { input: JSON.stringify(bad), encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refused/);
  assert.equal(refused.stdout, "");
});

test("input and output carriers conform to published JSON Schema 2020-12 shape", () => {
  const inSchema = JSON.parse(readFileSync(new URL("../data/schemas/source-custody-input.schema.json", import.meta.url), "utf8"));
  const outSchema = JSON.parse(readFileSync(new URL("../data/schemas/source-custody-output.schema.json", import.meta.url), "utf8"));
  assert.equal(inSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(inSchema.$defs.sourceCut.properties.coverage.const, "complete");
  assert.equal(outSchema.properties.authority.const, assaySourceCustody(make()).authority);
  assert.equal(outSchema.properties.kind.const, SOURCE_CUSTODY_ASSAY_KIND);
});
