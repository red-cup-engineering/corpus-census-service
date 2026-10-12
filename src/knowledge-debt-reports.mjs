/**
 * The knowledge ledger's Analyze step: each owning section's ratchet debt reported on the work
 * arena as a nonconformity (ISO 9001 §10.2), never asked for as work and never allocated (note
 * 2026-10-02 "The work arena's sixth edition"). A measurement finds a law broken; it does not
 * demand. The report names its law and its subject (the section), so it is that condition's one
 * thread: the section's micro-enterprise, whose territory it sits in, adopts it and restores the
 * law by a method it chooses and staffs, and the ledger reads the result by measuring again.
 *
 * One report per section, because the section's live carriers are the write set: two sections'
 * conditions commute, and the debts within one section conflict. Each nonzero debt is counted in
 * the observation and named in the tags; the law is one, the ratchet's (every live carrier carries
 * no ratchet debt). The derivation entry keeps the command that re-reads it
 * (`census-corpus --section <s> --only --assert <measure><=0`): verifying a repair is the ledger's
 * own measurement, so it stays with the ledger rather than on the board. Section addresses are relative to the house agency root, while the commands keep
 * census-relative paths.
 *
 * A report's thread is named by its law and subject, never by the counts measured, so deriving
 * again while a section's debt persists yields the same thread; the counts travel in its
 * observation. The ledger keeps its standing on the board through its own loop: the derivation is
 * a record its enterprise `derives`, which the loop reconciles (organizing
 * `reconcileDerivedOpenings`): a new nonconformity is reported, a repaired one is resolved with the
 * measurement as evidence, and one that comes back after being resolved is corroborated, which
 * reopens it.
 * @packageDocumentation
 */
import { posix } from "node:path";
import { houseSectionOf, openingOf } from "@red-cup-engineering/organizing/enterprise";
import { measureScheme, RATCHET_MEASURES } from "./corpus-ledger.mjs";

/** The micro-enterprise that holds the ledger and reports what it measures. */
export const KNOWLEDGE_LEDGER_ENTERPRISE = "corpus-knowledge-ledger";
export const KNOWLEDGE_DEBT_REPORTS_KIND = "computer-corpus-knowledge-debt-reports.v1";

/** The ratchet's law, which every live section's own carriers keep. */
export const RATCHET_LAW = "The live carriers of a section, excluding its subsections, carry no ratchet debt: no broken links, unresolved wikilinks, unlawful citekeys or refused carriers.";

/** Each ratchet debt by the name it is counted and tagged under. */
const DEBTS = Object.freeze({
  brokenLinks: Object.freeze({ name: "broken-links", what: "path links that name no tracked file" }),
  unresolvedWikilinks: Object.freeze({ name: "unresolved-wikilinks", what: "wikilinks that resolve to no carrier" }),
  unlawfulCitekeys: Object.freeze({ name: "unlawful-citekeys", what: "citekeys outside the citing carrier's own references map" }),
  refusals: Object.freeze({ name: "refusals", what: "carriers their schema's owner refuses" }),
});

/** A section's name in work scopes: its path without the `services/` steps (an app keeps its
 *  `apps/` step, so it never reads like a section of the same name). */
export function sectionScopeName(section) {
  return section === "" ? "root" : section.replace(/(^|\/)services\//gu, "$1");
}

/**
 * Derive the ledger's reports from one census: one per live section carrying ratchet debt,
 * largest debt first.
 * @param {ReadonlyArray<object>} rows the census rows at `commit`
 * @param {{commit: string, date: string, directory: string, script: string, root: string,
 *   census: string, agencyRoot: string, poster?: string}} options `directory` is the absolute
 *   repository top where the re-reading command runs; `script` (the census script), `root` (the
 *   corpus root) and `census` (the directory of dated census records, the reports' evidence) are
 *   relative to it. `agencyRoot` is the house address basis, also relative to `directory`.
 */
export function deriveKnowledgeDebtReports(rows, { commit, date, directory, script, root, census, agencyRoot, poster = KNOWLEDGE_LEDGER_ENTERPRISE }) {
  if (!posix.isAbsolute(directory)) throw new TypeError("the re-reading directory is absolute");
  if (typeof census !== "string" || census === "") throw new TypeError("the census records' directory is named");
  if (typeof agencyRoot !== "string" || agencyRoot === "") throw new TypeError("the house agency root is named");
  const corpusAddress = posix.relative(posix.resolve(directory, agencyRoot), posix.resolve(directory, root));
  if (corpusAddress === ".." || corpusAddress.startsWith("../")) throw new TypeError("the corpus belongs inside the house agency root");
  const sections = [...new Set(rows.filter((row) => row.stratum === "live").map((row) => row.section))].sort();
  const derived = [];
  for (const section of sections) {
    const measures = measureScheme(rows, section, { only: true });
    const owed = RATCHET_MEASURES.filter((measure) => measures[measure] > 0);
    if (owed.length === 0) continue;
    const debt = Object.fromEntries(owed.map((measure) => [measure, measures[measure]]));
    const opening = reportOfSection({ section, address: posix.join(corpusAddress, section), debt, poster, census: posix.join(census, `${date}.json`), date });
    const reread = `node ${script} --root ${root} --section ${section} --only --assert ${owed.map((measure) => `${measure}<=0`).join(" --assert ")}`;
    derived.push(Object.freeze({ section, total: owed.reduce((sum, measure) => sum + debt[measure], 0), debt: Object.freeze(debt), reread, opening }));
  }
  derived.sort((left, right) => right.total - left.total || left.section.localeCompare(right.section));
  const total = derived.reduce((sum, entry) => sum + entry.total, 0);
  let running = 0;
  const head = derived.findIndex((entry) => (running += entry.total) >= 0.9 * total) + 1;
  return Object.freeze({
    kind: KNOWLEDGE_DEBT_REPORTS_KIND,
    commit,
    date,
    poster,
    law: RATCHET_LAW,
    // It measures the ratchet's law, so it settles only its poster's reports under that law.
    domain: Object.freeze({ laws: Object.freeze([RATCHET_LAW]) }),
    measures: RATCHET_MEASURES,
    debt: total,
    sections: derived.length,
    sectionsHoldingNinetyPercent: head,
    openings: Object.freeze(derived),
  });
}

/** The report one section's debts make: what `deriveKnowledgeDebtReports` opens for it. */
export function reportOfSection({ section, address, debt, poster, census, date }) {
  const owed = Object.keys(debt);
  const counted = owed.map((measure) => `${debt[measure]} ${DEBTS[measure].name.replaceAll("-", " ")} (${DEBTS[measure].what})`);
  // A statement names the section by its own step, which a reader takes in at once; its house
  // address is the subject and the scope (which routes the report home), in the one canonical
  // spelling, so the same section is always the same thread.
  const at = `section:${houseSectionOf(address)}`;
  const where = section === "" ? "the corpus root" : `section ${posix.basename(section)}`;
  return openingOf({
    move: "report",
    by: poster,
    law: RATCHET_LAW,
    subject: at,
    observation: `The live carriers of ${where}, excluding its subsections, carry ${counted.join("; ")}.`,
    evidence: [census],
    scope: [`project:knowledge-debt/${sectionScopeName(section)}`, at],
    tags: ["knowledge-debt", ...owed.map((measure) => DEBTS[measure].name)],
    sources: [{ kind: "corpus-census", locator: census }],
    at: `${date}T00:00:00.000Z`,
  });
}
