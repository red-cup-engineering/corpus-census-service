import { test } from "node:test";
import assert from "node:assert/strict";
import { carrierFactsKey, censusCorpus, classifyLinkTarget, isCorpusCarrierPath, kindOf, readCarrierFacts, renderCorpusRows, roleOf, sectionOf, stratumOf } from "../src/corpus-census.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SECTION = "services/a-section";
const TERMS = `${SECTION}/content/text/glossary/terms`;
const NOTES = `${SECTION}/content/text/documents/articles/notes/2026/09/30`;

test("carrier paths, strata, sections, roles and kinds come from the path alone", () => {
  assert.equal(isCorpusCarrierPath(`${TERMS}/x.md`), true);
  assert.equal(isCorpusCarrierPath(`${SECTION}/test/fixtures/x.md`), false);
  assert.equal(isCorpusCarrierPath(`${SECTION}/node_modules/p/README.md`), false);
  assert.equal(stratumOf(`${SECTION}/lib/legacy/x.md`), "archive");
  assert.equal(stratumOf(`${NOTES}/x.md`), "live");
  assert.equal(sectionOf(`${SECTION}/services/b-section/apps/c/README.md`), `${SECTION}/services/b-section/apps/c`);
  assert.equal(sectionOf("README.md"), "");
  assert.equal(roleOf(`${NOTES}/x.md`, SECTION), "content/text/documents/articles/notes");
  assert.equal(kindOf("content/text/glossary/terms", "x"), "term");
  assert.equal(kindOf("content/text/documents/articles/notes/books/ice-out", "x"), "note");
  assert.equal(kindOf("content/text/documents/bibliographies", "x"), "bibliography");
  assert.equal(kindOf("", "README"), "readme");
});

test("link targets classify against the tracked path set", () => {
  const tracked = new Set([`${TERMS}/a.md`, `${TERMS}/b.md`, `${SECTION}/README.md`]);
  const directories = new Set(["", "services", SECTION, `${SECTION}/content`, `${SECTION}/content/text`, `${SECTION}/content/text/glossary`, TERMS]);
  const from = `${TERMS}/a.md`;
  assert.equal(classifyLinkTarget("b.md", from, tracked, directories).status, "resolved");
  assert.equal(classifyLinkTarget("b", from, tracked, directories).status, "resolved");
  assert.equal(classifyLinkTarget("../../../../README.md#top", from, tracked, directories).status, "resolved");
  assert.equal(classifyLinkTarget("../terms/", from, tracked, directories).status, "resolved");
  assert.deepEqual(classifyLinkTarget("c%20d.md", from, tracked, directories), { status: "broken", named: `${TERMS}/c d.md` });
  assert.equal(classifyLinkTarget("https://example.org", from, tracked, directories).status, "external");
  assert.equal(classifyLinkTarget("zotero://select", from, tracked, directories).status, "scheme");
  assert.equal(classifyLinkTarget("#heading", from, tracked, directories).status, "same-document");
  assert.equal(classifyLinkTarget("../../../../../../../out.md", from, tracked, directories).status, "escaped");
});

function snapshot() {
  const documents = [
    { path: `${TERMS}/alpha.md`, object: "a".repeat(40), text: "---\nname: alpha\ndescription: The first letter.\nvisibility: public\n---\n\nAlpha names the first position in an ordering. See [beta](beta.md) and [[gamma]] and [[missing page]].\n" },
    { path: `${TERMS}/beta.md`, object: "b".repeat(40), text: "---\nname: beta\nbogus: 1\n---\n\nBeta links to [nowhere](nowhere.md) and cites [@smith2020; @jones2021].\n" },
    { path: `${NOTES}/gamma.md`, object: "c".repeat(40), text: "---\ntitle: Gamma\nreferences:\n  smith2020: {}\n---\n\nCites [@smith2020] and [[Missing Page|again]]; [broken](nowhere.md).\n" },
    { path: `${SECTION}/content/text/documents/bibliographies/jones2021.md`, object: "d".repeat(40), text: "---\ntype: reference\n---\n\nJones.\n" },
    { path: `${SECTION}/lib/legacy/old.md`, object: "e".repeat(40), text: "no frontmatter [[nothing]]\n" },
    { path: `${SECTION}/notes.org`, object: "f".repeat(40), text: "#+TITLE: Org\n\n* Heading\n" },
  ];
  return { commit: COMMIT, date: "2026-09-30", paths: documents.map(({ path }) => path), documents };
}

test("the census admits, resolves, and queues demand per carrier", () => {
  const { record, rows, wanted } = censusCorpus(snapshot());
  const row = (stem) => rows.find(({ identity }) => identity === stem);
  assert.equal(record.schema, "computer-corpus-census.v1");
  assert.equal(record.headline.liveCarriers, 5);
  assert.equal(record.headline.archiveCarriers, 1);
  assert.equal(record.headline.livePublic, 1);
  assert.equal(row("alpha").schema, "term");
  assert.equal(row("alpha").admitted, "true");
  assert.equal(row("alpha").public, true);
  assert.equal(row("alpha").iri, "https://561.group/knowledge/a-section/alpha");
  assert.equal(row("beta").admitted, "false");
  assert.match(row("beta").rules, /unknown-key/u);
  assert.equal(row("beta").brokenLinks, 1);
  assert.equal(row("alpha").unresolvedWikilinks, 1);
  assert.equal(row("beta").unlawfulCitekeys, 2, "covered keys are still outside beta's own map");
  assert.equal(row("gamma").unlawfulCitekeys, 0);
  assert.equal(row("gamma").schema, "note", "a note is claimed by the schema its directory's kind names");
  assert.equal(row("gamma").admitted, "false");
  assert.equal(row("gamma").rules, "required:date-created,required:description,required:references", "each rule names the keyword and the top-level key it failed on");
  assert.equal(row("jones2021").schema, "bibliography");
  assert.equal(row("notes").frontmatter, "org-header");
  assert.equal(row("old").stratum, "archive");
  assert.equal(record.strata.live.citekeys.resolved, 1);
  assert.equal(record.strata.live.citekeys.covered, 2);
  assert.deepEqual(wanted.pages.map(({ target, referrers, occurrences }) => [target, referrers, occurrences]), [["missing page", 2, 2]]);
  assert.deepEqual(wanted.references, []);
  assert.equal(wanted.paths.length, 0);
  assert.equal(wanted.unlistedPaths, 2, "each carrier's nowhere.md names a different path");
});

test("the census is deterministic and refuses a malformed snapshot", () => {
  const input = snapshot();
  const first = censusCorpus(input);
  const second = censusCorpus({ ...input, documents: [...input.documents].reverse() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(renderCorpusRows(first.rows), renderCorpusRows(second.rows));
  assert.throws(() => censusCorpus({ ...input, commit: "HEAD" }), TypeError);
  assert.throws(() => censusCorpus({ ...input, date: "today" }), TypeError);
});

test("facts read once are the census read again, kept by blob and what the path decides", () => {
  const input = snapshot();
  const fromFacts = censusCorpus({ ...input, documents: input.documents.map(({ path, object, text }) => ({ path, object, facts: readCarrierFacts({ path, text }) })) });
  assert.equal(JSON.stringify(fromFacts), JSON.stringify(censusCorpus(input)));
  const object = "a".repeat(40);
  assert.equal(carrierFactsKey(`${NOTES}/x.md`, object), carrierFactsKey(`${NOTES}/2026/y.md`, object), "a note's admission reads its bytes and its kind, not its filename");
  assert.notEqual(carrierFactsKey(`${NOTES}/x.md`, object), carrierFactsKey(`${SECTION}/y.md`, object), "a note is admitted by a schema a plain carrier is not");
  assert.notEqual(carrierFactsKey(`${TERMS}/x.md`, object), carrierFactsKey(`${TERMS}/y.md`, object), "a term's recognizer reads its filename");
  assert.notEqual(carrierFactsKey(`${NOTES}/x.md`, object), carrierFactsKey(`${NOTES}/x.org`, object));
});
