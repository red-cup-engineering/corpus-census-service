import { createHash } from "node:crypto";
import { posix } from "node:path";
import { buildWikilinkIndex, resolveWikilink } from "@red-cup-engineering/markdown-engineering-services-section/vault-dialect/wikilink";
import { DEFAULT_KNOWLEDGE_BASE, schemeIriPath } from "@red-cup-engineering/term-engineering-services-section/glossary-skos";
import { kindOf, roleOf, sectionOf, stemOf } from "@red-cup-engineering/carrier-kind-engineering-services-section/carrier-path";
import { BIBLIOGRAPHY_CARRIER, readBibtexKeys, readCarrierFacts } from "./carrier-facts.mjs";

export { carrierFactsKey, readBibtexKeys, readCarrierFacts } from "./carrier-facts.mjs";
export { kindOf, roleOf, sectionOf } from "@red-cup-engineering/carrier-kind-engineering-services-section/carrier-path";

const SCHEMA = "computer-corpus-census.v1";
const WANTED_SCHEMA = "computer-corpus-wanted.v1";
/** Directories that are never corpus: dependencies, builds, and test fixtures. */
const EXCLUDED_SEGMENTS = new Set(["node_modules", "dist", "test", "tests", "fixtures", "__fixtures__"]);
/** Directories whose carriers are kept as evidence, not as the live corpus. */
const ARCHIVE_SEGMENTS = new Set(["lib", "legacy", "triage", "recovered", "_archive", "lenticule-import"]);
const CARRIER_EXTENSIONS = [".md", ".org"];
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const WEB_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const SAMPLE_REFERRERS = 3;
/** A wanted path needs this many referrers to be listed; fewer are only counted. */
const LISTED_PATH_REFERRERS = 3;
const STRATA = ["live", "archive"];

/**
 * Whether a root-relative path is a corpus carrier: a Markdown or Org file outside dependency,
 * build, and test-fixture directories.
 * @param {string} path
 */
export function isCorpusCarrierPath(path) {
  if (!CARRIER_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
  return !path.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

/**
 * `archive` for a carrier kept under a library, legacy, triage, or recovery directory (evidence
 * the corpus grew from), `live` otherwise.
 * @param {string} path
 */
export function stratumOf(path) {
  return path.split("/").slice(0, -1).some((segment) => ARCHIVE_SEGMENTS.has(segment)) ? "archive" : "live";
}

function increment(map, key, by = 1) { map.set(key, (map.get(key) ?? 0) + by); }
function byKey(map) { return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right))); }
function byCount(map, limit = Infinity) {
  return Object.fromEntries([...map.entries()].sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey)).slice(0, limit));
}
function tsvCell(value) { return String(value ?? "").replace(/[\t\n\r]/gu, " "); }

function directoriesOf(paths) {
  const directories = new Set([""]);
  for (const path of paths) {
    let at = path.lastIndexOf("/");
    while (at > 0) { const directory = path.slice(0, at); if (directories.has(directory)) break; directories.add(directory); at = directory.lastIndexOf("/"); }
  }
  return directories;
}

function decodeTarget(target) {
  const bare = target.replace(/^<|>$/gu, "").split("#")[0].split("?")[0];
  try { return decodeURIComponent(bare); } catch { return bare; }
}

/**
 * Classify one Markdown link destination written in `path` against the tracked path set: a web
 * link is `external`, any other URI scheme `scheme`, a bare fragment `same-document`; a relative
 * (or root-anchored `/`) path is `resolved` when it names a tracked file or directory (or a file
 * once `.md` is implied, as static-site generators read it), `escaped` when it leaves the root,
 * and `broken` otherwise, carrying the root-relative path it named.
 */
export function classifyLinkTarget(target, path, tracked, directories) {
  const scheme = target.match(URI_SCHEME)?.[0]?.toLowerCase();
  if (scheme !== undefined) return { status: WEB_SCHEMES.has(scheme) ? "external" : "scheme" };
  const decoded = decodeTarget(target);
  if (decoded === "") return { status: "same-document" };
  const joined = decoded.startsWith("/") ? posix.normalize(decoded.slice(1)) : posix.normalize(posix.join(posix.dirname(path), decoded));
  if (joined === ".." || joined.startsWith("../")) return { status: "escaped" };
  const named = joined.replace(/\/$/u, "") === "." ? "" : joined.replace(/\/$/u, "");
  if (tracked.has(named) || directories.has(named) || tracked.has(`${named}.md`)) return { status: "resolved" };
  return { status: "broken", named };
}

function wikilinkKey(raw) {
  return raw.split("|")[0].split("#")[0].trim().replace(/\.md$/iu, "").toLowerCase();
}

function emptyTotals() {
  return {
    carriers: 0, md: 0, org: 0,
    frontmatter: new Map(), visibility: new Map(), public: 0,
    schemas: new Map(), refusalRules: new Map(),
    kinds: new Map(), types: new Map(),
    links: new Map(), wikilinks: new Map(), citekeys: new Map(),
  };
}

function totalsRecord(totals) {
  return {
    carriers: totals.carriers, md: totals.md, org: totals.org,
    frontmatter: byKey(totals.frontmatter),
    visibility: byKey(totals.visibility),
    publicCarriers: totals.public,
    schemas: byKey(totals.schemas),
    refusalRules: byCount(totals.refusalRules),
    links: byKey(totals.links),
    wikilinks: byKey(totals.wikilinks),
    citekeys: byKey(totals.citekeys),
    kinds: byCount(totals.kinds, 60),
    types: byCount(totals.types, 60),
  };
}

function rate(part, whole) { return whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000; }

function demand(map, key, referrer) {
  const entry = map.get(key) ?? { occurrences: 0, referrers: new Set() };
  entry.occurrences += 1;
  entry.referrers.add(referrer);
  map.set(key, entry);
}

function demandQueue(map, field, minimumReferrers = 1) {
  return [...map.entries()]
    .filter(([, { referrers }]) => referrers.size >= minimumReferrers)
    .map(([key, { occurrences, referrers }]) => ({ [field]: key, referrers: referrers.size, occurrences, sample: [...referrers].sort().slice(0, SAMPLE_REFERRERS) }))
    .sort((left, right) => right.referrers - left.referrers || right.occurrences - left.occurrences || left[field].localeCompare(right[field]));
}

/**
 * Census every content carrier in a corpus snapshot: one row per carrier saying who owns it, what
 * kind it is, whether its frontmatter reads, who may see it, whether the schema that claims it
 * admits it, and how many of its links, wikilinks, and citekeys land; plus the authorship demand
 * the live corpus states and nothing answers yet (wanted pages, wanted references, wanted paths).
 * Pure: the caller reads the snapshot, so the same snapshot yields byte-identical output. The
 * record names the rows' count, columns and the SHA-256 of their TSV `table`, so rows derived
 * again from the same commit can be checked against a record that never carried them.
 *
 * A citekey is `resolved` when the citing carrier's own `references:` map holds it, `covered`
 * when only another carrier's map, a bibliography carrier, or a BibTeX file knows it, and
 * `unknown` when nothing in the corpus does; only unknown keys are wanted. Wanted pages and
 * references are listed in full; a broken path is listed once three carriers name it, and the rest
 * are counted, since one stray link is repair work rather than demand.
 *
 * @param {{commit: string, date: string, base?: string, paths: readonly string[], documents: ReadonlyArray<{path: string, object: string, text?: string, facts?: ReturnType<typeof readCarrierFacts>}>, bibtex?: ReadonlyArray<{path: string, text?: string, keys?: string[]}>}} snapshot
 *   `paths` is every tracked path under the root; `documents` every carrier among them, each with
 *   its text or the facts `readCarrierFacts` read from it; `bibtex` each BibTeX file's text or keys.
 */
export function censusCorpus({ commit, date, base = DEFAULT_KNOWLEDGE_BASE, paths, documents, bibtex = [] } = {}) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40,64}$/u.test(commit)) throw new TypeError("commit must be an object id");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new TypeError("date must be YYYY-MM-DD");
  if (!Array.isArray(paths) || !Array.isArray(documents)) throw new TypeError("paths and documents must be arrays");
  const tracked = new Set(paths);
  const directories = directoriesOf(paths);
  const sorted = [...documents].sort((left, right) => left.path.localeCompare(right.path));

  const carriers = sorted.map(({ path, object, text, facts }) => {
    const section = sectionOf(path);
    return { path, object, facts: facts ?? readCarrierFacts({ path, text }), section, role: roleOf(path, section), stem: stemOf(path), stratum: stratumOf(path) };
  });

  const knownCitekeys = new Set();
  for (const { path, stem, facts } of carriers) {
    for (const key of facts.references) knownCitekeys.add(key);
    if (BIBLIOGRAPHY_CARRIER.test(path)) knownCitekeys.add(stem);
  }
  for (const { text, keys } of bibtex) for (const key of keys ?? readBibtexKeys(text)) knownCitekeys.add(key);

  const wikilinkIndex = buildWikilinkIndex(carriers.map(({ path, facts }) => ({ id: path, aliases: facts.aliases })));
  const iriCarriers = new Map();
  for (const { section, stem, stratum } of carriers) if (stratum === "live") increment(iriCarriers, `${section}\u0000${stem}`);

  const strata = Object.fromEntries(STRATA.map((stratum) => [stratum, emptyTotals()]));
  const sections = new Map();
  const wantedPages = new Map();
  const wantedReferences = new Map();
  const wantedPaths = new Map();
  const rows = [];

  for (const carrier of carriers) {
    const { path, object, facts, section, role, stem, stratum } = carrier;
    const { medium, format, visibility, schema, admitted, rules } = facts;
    const live = stratum === "live";
    const totals = strata[stratum];
    const kind = kindOf(role, stem);
    const isPublic = facts.public;

    const links = new Map();
    const wikilinks = new Map();
    const citekeys = new Map();
    for (const target of facts.links) {
      const { status, named } = classifyLinkTarget(target, path, tracked, directories);
      increment(links, status);
      if (status === "broken" && live) demand(wantedPaths, named, path);
    }
    for (const targetRaw of facts.wikilinks) {
      const resolved = resolveWikilink(targetRaw, path, wikilinkIndex);
      increment(wikilinks, resolved.kind);
      if (resolved.kind === "unresolved" && live) demand(wantedPages, wikilinkKey(targetRaw), path);
    }
    const own = new Set(facts.references);
    for (const key of facts.citekeys) {
      const status = own.has(key) ? "resolved" : knownCitekeys.has(key) ? "covered" : "unknown";
      increment(citekeys, status);
      if (status === "unknown" && live) demand(wantedReferences, key, path);
    }
    const citekeyCount = [...citekeys.values()].reduce((sum, count) => sum + count, 0);
    const unlawfulCitekeys = citekeyCount - (citekeys.get("resolved") ?? 0);

    totals.carriers += 1;
    totals[medium] += 1;
    increment(totals.frontmatter, format);
    increment(totals.visibility, visibility === "" ? "unstated" : visibility);
    if (isPublic) totals.public += 1;
    increment(totals.schemas, admitted === "" ? schema : `${schema}:${admitted === "true" ? "admitted" : "refused"}`);
    for (const rule of rules) increment(totals.refusalRules, `${schema}:${rule}`);
    increment(totals.kinds, kind);
    increment(totals.types, facts.type || "(none)");
    for (const [status, count] of links) increment(totals.links, status, count);
    for (const [status, count] of wikilinks) increment(totals.wikilinks, status, count);
    for (const [status, count] of citekeys) increment(totals.citekeys, status, count);

    const ambiguousIri = live && (iriCarriers.get(`${section}\u0000${stem}`) ?? 0) > 1;
    if (live) {
      const top = section.split("/").slice(0, 4).join("/") || "(root)";
      const entry = sections.get(top) ?? { carriers: 0, links: 0, brokenLinks: 0, wikilinks: 0, unresolvedWikilinks: 0, unlawfulCitekeys: 0, refusals: 0, frontmatterless: 0, public: 0, ambiguousIdentities: 0 };
      entry.carriers += 1;
      entry.links += [...links.values()].reduce((sum, count) => sum + count, 0);
      entry.brokenLinks += links.get("broken") ?? 0;
      entry.wikilinks += [...wikilinks.values()].reduce((sum, count) => sum + count, 0);
      entry.unresolvedWikilinks += wikilinks.get("unresolved") ?? 0;
      entry.unlawfulCitekeys += unlawfulCitekeys;
      if (admitted === "false") entry.refusals += 1;
      if (format === "none") entry.frontmatterless += 1;
      if (isPublic) entry.public += 1;
      if (ambiguousIri) entry.ambiguousIdentities += 1;
      sections.set(top, entry);
    }

    rows.push({
      path, stratum, section, identity: stem, kind, type: facts.type, frontmatter: format, visibility, public: isPublic,
      schema, admitted, rules: rules.join(","),
      links: [...links.values()].reduce((sum, count) => sum + count, 0), brokenLinks: links.get("broken") ?? 0,
      wikilinks: [...wikilinks.values()].reduce((sum, count) => sum + count, 0), unresolvedWikilinks: wikilinks.get("unresolved") ?? 0, ambiguousWikilinks: wikilinks.get("ambiguous") ?? 0,
      citekeys: citekeyCount, unknownCitekeys: citekeys.get("unknown") ?? 0, unlawfulCitekeys,
      iri: `${base}${schemeIriPath(section)}/${stem}`, ambiguousIri, object,
    });
  }

  const liveIdentities = [...iriCarriers.values()];
  const live = strata.live;
  const sumOf = (map) => [...map.values()].reduce((sum, count) => sum + count, 0);
  const table = renderCorpusRows(rows);
  const record = Object.freeze({
    schema: SCHEMA,
    date,
    commit,
    base,
    rows: { count: rows.length, columns: CORPUS_ROW_COLUMNS, sha256: createHash("sha256").update(table).digest("hex") },
    headline: {
      liveCarriers: live.carriers,
      archiveCarriers: strata.archive.carriers,
      liveIdentities: liveIdentities.length,
      ambiguousLiveIdentities: liveIdentities.filter((count) => count > 1).length,
      liveCarriersBehindAmbiguousIdentities: liveIdentities.filter((count) => count > 1).reduce((sum, count) => sum + count, 0),
      liveWithoutFrontmatter: live.frontmatter.get("none") ?? 0,
      liveMalformedFrontmatter: live.frontmatter.get("malformed") ?? 0,
      livePublic: live.public,
      brokenLinkRate: rate(live.links.get("broken") ?? 0, (live.links.get("broken") ?? 0) + (live.links.get("resolved") ?? 0)),
      unresolvedWikilinkRate: rate(live.wikilinks.get("unresolved") ?? 0, sumOf(live.wikilinks)),
      unknownCitekeyRate: rate(live.citekeys.get("unknown") ?? 0, sumOf(live.citekeys)),
      wantedPages: wantedPages.size,
      wantedReferences: wantedReferences.size,
      wantedPaths: wantedPaths.size,
    },
    strata: Object.fromEntries(STRATA.map((stratum) => [stratum, totalsRecord(strata[stratum])])),
    sections: Object.fromEntries([...sections.entries()].sort(([left], [right]) => left.localeCompare(right))),
  });
  const wanted = Object.freeze({
    schema: WANTED_SCHEMA,
    date,
    commit,
    pages: demandQueue(wantedPages, "target"),
    references: demandQueue(wantedReferences, "citekey"),
    paths: demandQueue(wantedPaths, "path", LISTED_PATH_REFERRERS),
    unlistedPaths: [...wantedPaths.values()].filter(({ referrers }) => referrers.size < LISTED_PATH_REFERRERS).length,
  });
  return Object.freeze({ record, rows: Object.freeze(rows), table, wanted });
}

export const CORPUS_ROW_COLUMNS = Object.freeze(["path", "stratum", "section", "identity", "kind", "type", "frontmatter", "visibility", "public", "schema", "admitted", "rules", "links", "brokenLinks", "wikilinks", "unresolvedWikilinks", "ambiguousWikilinks", "citekeys", "unknownCitekeys", "unlawfulCitekeys", "ambiguousIri", "object"]);

/**
 * The census rows as a TSV table, one carrier per line under a header naming `CORPUS_ROW_COLUMNS`.
 * @param {ReadonlyArray<object>} rows
 */
export function renderCorpusRows(rows) {
  return [CORPUS_ROW_COLUMNS.join("\t"), ...rows.map((row) => CORPUS_ROW_COLUMNS.map((column) => tsvCell(row[column])).join("\t"))].join("\n") + "\n";
}
