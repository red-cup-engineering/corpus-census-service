/**
 * Read-only, source-revision-locked Git blob custody assay.
 *
 * A caller supplies THREE complete Git-provider tree cuts, already collected
 * under its own source authority. This module neither obtains repositories nor
 * writes, merges, reclassifies, deletes, or invents a Thing. Equal Git blobs
 * establish byte identity, not equivalence of scientific theories, proof paths,
 * repository permissions, or an Actor's authority to read/use a resource.
 */
export const SOURCE_CUT_KIND = "corpus.git-source-cut/v1";
export const SOURCE_CUSTODY_ASSAY_KIND = "corpus.source-custody-assay/v1";

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAX_ENTRIES = 50_000;
const MAX_PATH = 4096;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const CUT_KEYS = new Set(["kind", "repository", "revision", "prefix", "coverage", "entries"]);
const ENTRY_KEYS = new Set(["path", "blob", "bytes"]);
const PACKET_KEYS = new Set(["original", "legacy", "canonical"]);
const hasUnexpectedKey = (value, keys) => Object.keys(value).some(key => !keys.has(key));
const canonicalStatusOf = paths => paths.length === 0 ? "unobserved" : paths.length === 1 ? "unique-byte-peer" : "ambiguous-byte-peers";

function sourcePath(path) {
  if (typeof path !== "string" || !path || path.length > MAX_PATH ||
      path.startsWith("/") || path.includes("\\") || path.includes("\0") ||
      path.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new TypeError("source cut needs bounded canonical repository-relative paths");
  return path;
}

function sourceCut(input, role) {
  if (!isRecord(input) || hasUnexpectedKey(input, CUT_KEYS) || input.kind !== SOURCE_CUT_KIND ||
      !REPOSITORY.test(input.repository ?? "") ||
      !OID.test(input.revision ?? "") ||
      input.coverage !== "complete" ||
      typeof input.prefix !== "string" ||
      (input.prefix !== "" && sourcePath(input.prefix) !== input.prefix) ||
      !Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES)
    throw new TypeError(role + ": source cut requires one complete, revision-locked Git provider observation");
  const paths = new Set();
  const entries = input.entries.map(row => {
    if (!isRecord(row) || hasUnexpectedKey(row, ENTRY_KEYS) || !OID.test(row.blob ?? ""))
      throw new TypeError(role + ": missing original Git blob object identity");
    const path = sourcePath(row.path);
    if (paths.has(path)) throw new TypeError(role + ": repeated path in source cut");
    paths.add(path);
    if (row.bytes !== undefined && (!Number.isSafeInteger(row.bytes) || row.bytes < 0))
      throw new TypeError(role + ": invalid source byte count");
    return Object.freeze({ path, blob: row.blob, ...(row.bytes === undefined ? {} : { bytes: row.bytes }) });
  }).sort((left, right) => compare(left.path, right.path));
  return Object.freeze({ role, repository: input.repository, revision: input.revision,
    prefix: input.prefix, coverage: "complete", entries: Object.freeze(entries) });
}

/**
 * One source-cut assay over original archive, legacy projection, and current
 * mathematical source home. The two historical cuts are compared by their
 * *relative path*, while the canonical cut is looked up by Git blob identity,
 * since a migrated manuscript's earned typed path and filename can differ.
 *
 * "exact-three-way" is evidence for a proposed duplicate-retirement review,
 * not deletion authorization: links, citations, grants, semantic equivalence,
 * and consumer receiving are deliberately outside this pure byte assay.
 */
export function assaySourceCustody(packet = {}) {
  if (!isRecord(packet) || hasUnexpectedKey(packet, PACKET_KEYS))
    throw new TypeError("source custody packet must contain only the three original source cuts");
  const { original, legacy, canonical } = packet;
  const cuts = [sourceCut(original, "original"), sourceCut(legacy, "legacy"), sourceCut(canonical, "canonical")];
  const [first, second, current] = cuts;
  if (new Set(cuts.map(cut => cut.repository)).size !== 3)
    throw new TypeError("source custody requires three distinct qualified repository owners");
  const legacyByPath = new Map(second.entries.map(row => [row.path, row]));
  const originalByPath = new Map(first.entries.map(row => [row.path, row]));
  const canonicalByBlob = new Map();
  for (const row of current.entries) {
    const at = canonicalByBlob.get(row.blob) ?? [];
    at.push(row.path);
    canonicalByBlob.set(row.blob, at);
  }
  const rows = [];
  const counts = { exactThreeWay: 0, equalHistoricalOnly: 0, differentHistoricalBytes: 0,
    originalOnly: 0, legacyOnly: 0, ambiguousCanonical: 0, noCanonicalBlob: 0,
    divergentOriginalExactOnly: 0, divergentLegacyExactOnly: 0,
    divergentBothExact: 0, divergentNoSingleExact: 0 };
  for (const entry of first.entries) {
    const peer = legacyByPath.get(entry.path);
    const homes = canonicalByBlob.get(entry.blob) ?? [];
    const legacyHomes = peer ? canonicalByBlob.get(peer.blob) ?? [] : [];
    const canonicalStatus = canonicalStatusOf(homes);
    const legacyCanonicalStatus = canonicalStatusOf(legacyHomes);
    let relation;
    if (!peer) { relation = "original-only"; counts.originalOnly++; }
    else if (peer.blob !== entry.blob) {
      relation = "different-historical-bytes"; counts.differentHistoricalBytes++;
      const originalExact = homes.length === 1;
      const legacyExact = legacyHomes.length === 1;
      if (originalExact && legacyExact) counts.divergentBothExact++;
      else if (originalExact) counts.divergentOriginalExactOnly++;
      else if (legacyExact) counts.divergentLegacyExactOnly++;
      else counts.divergentNoSingleExact++;
    }
    else if (homes.length === 1) { relation = "exact-three-way"; counts.exactThreeWay++; }
    else { relation = "equal-historical-only"; counts.equalHistoricalOnly++; }
    if (homes.length === 0) counts.noCanonicalBlob++;
    if (homes.length > 1) counts.ambiguousCanonical++;
    rows.push(Object.freeze({ path: entry.path, originalBlob: entry.blob,
      legacyBlob: peer?.blob ?? null, canonicalPaths: Object.freeze([...homes]),
      canonicalStatus, legacyCanonicalPaths: Object.freeze([...legacyHomes]),
      legacyCanonicalStatus, relation }));
  }
  for (const entry of second.entries) if (!originalByPath.has(entry.path)) {
    counts.legacyOnly++;
    const legacyHomes = canonicalByBlob.get(entry.blob) ?? [];
    rows.push(Object.freeze({ path: entry.path, originalBlob: null,
      legacyBlob: entry.blob, canonicalPaths: Object.freeze([...legacyHomes]),
      canonicalStatus: canonicalStatusOf(legacyHomes),
      legacyCanonicalPaths: Object.freeze([...legacyHomes]),
      legacyCanonicalStatus: canonicalStatusOf(legacyHomes), relation: "legacy-only" }));
  }
  rows.sort((left, right) => compare(left.path, right.path));
  return Object.freeze({ kind: SOURCE_CUSTODY_ASSAY_KIND,
    sources: Object.freeze(cuts.map(({ role, repository, revision, prefix, coverage }) =>
      Object.freeze({ role, repository, revision, prefix, coverage }))),
    counts: Object.freeze(counts), rows: Object.freeze(rows),
    authority: "source-bytes-only-no-content-grant-no-retirement-effect",
    semanticStatus: "byte-identity-not-proposition-equivalence-or-machine-checked-proof" });
}
