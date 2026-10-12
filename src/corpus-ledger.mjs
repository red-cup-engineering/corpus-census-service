import { posix } from "node:path";

/**
 * What the ledger measures over a scheme's live census rows, each a count. A work item's
 * acceptance is an assertion over one of these, and the ratchet holds the debts among them.
 */
export const LEDGER_MEASURES = Object.freeze({
  carriers: () => 1,
  links: (row) => row.links,
  brokenLinks: (row) => row.brokenLinks,
  wikilinks: (row) => row.wikilinks,
  unresolvedWikilinks: (row) => row.unresolvedWikilinks,
  ambiguousWikilinks: (row) => row.ambiguousWikilinks,
  citekeys: (row) => row.citekeys,
  unlawfulCitekeys: (row) => row.unlawfulCitekeys,
  unknownCitekeys: (row) => row.unknownCitekeys,
  refusals: (row) => (row.admitted === "false" ? 1 : 0),
  unschematized: (row) => (row.schema === "none" ? 1 : 0),
  frontmatterless: (row) => (row.frontmatter === "none" ? 1 : 0),
  malformedFrontmatter: (row) => (row.frontmatter === "malformed" ? 1 : 0),
  public: (row) => (row.public ? 1 : 0),
  ambiguousIdentities: (row) => (row.ambiguousIri ? 1 : 0),
});

/** The debts no integration may raise in any section: broken path links, unresolved wikilinks,
 *  citekeys outside the citing carrier's own map, and schema refusals. */
export const RATCHET_MEASURES = Object.freeze(["brokenLinks", "unresolvedWikilinks", "unlawfulCitekeys", "refusals"]);

const COMPARE = Object.freeze({
  "<=": (left, right) => left <= right,
  ">=": (left, right) => left >= right,
  "<": (left, right) => left < right,
  ">": (left, right) => left > right,
  "=": (left, right) => left === right,
});
const ASSERTION = /^([A-Za-z]+)\s*(<=|>=|<|>|=)\s*(\d+)$/u;

/** Whether `section` is `scheme` or lies under it; every section lies under the root scheme `""`.
 *  With `only`, whether it is `scheme` itself, so the measure is the section's own write set. */
export function inScheme(section, scheme, only = false) {
  if (only) return section === scheme;
  return scheme === "" || section === scheme || section.startsWith(`${scheme}/`);
}

/**
 * Read one ledger assertion, `<measure><op><n>` with op one of `<=`, `>=`, `<`, `>`, `=`, such as
 * `brokenLinks<=0` or `unschematized<=120`.
 * @param {string} text
 */
export function parseLedgerAssertion(text) {
  const match = ASSERTION.exec(String(text).trim());
  if (!match) throw new TypeError(`a ledger assertion reads <measure><op><n>, not ${JSON.stringify(text)}`);
  const [, measure, op, value] = match;
  if (!Object.hasOwn(LEDGER_MEASURES, measure)) throw new TypeError(`${measure} is not a ledger measure; measures are ${Object.keys(LEDGER_MEASURES).join(", ")}`);
  return Object.freeze({ measure, op, value: Number(value), text: `${measure}${op}${value}` });
}

/**
 * Every ledger measure summed over the live rows of `scheme` and the sections under it, or with
 * `only` of `scheme`'s own carriers.
 * @param {ReadonlyArray<object>} rows census rows
 * @param {string} [scheme] a section path; the whole live corpus when omitted
 * @param {{only?: boolean}} [options]
 */
export function measureScheme(rows, scheme = "", { only = false } = {}) {
  const totals = Object.fromEntries(Object.keys(LEDGER_MEASURES).map((measure) => [measure, 0]));
  for (const row of rows) {
    if (row.stratum !== "live" || !inScheme(row.section, scheme, only)) continue;
    for (const [measure, of] of Object.entries(LEDGER_MEASURES)) totals[measure] += of(row);
  }
  return Object.freeze(totals);
}

/**
 * Each assertion read against `measures`: what it asserted, the measured value, and whether it holds.
 * @param {ReturnType<typeof measureScheme>} measures
 * @param {ReadonlyArray<ReturnType<typeof parseLedgerAssertion>>} assertions
 */
export function checkLedgerAssertions(measures, assertions) {
  return Object.freeze(assertions.map(({ measure, op, value, text }) => Object.freeze({ assertion: text, measured: measures[measure], holds: COMPARE[op](measures[measure], value) })));
}

/**
 * Pair each candidate carrier at a path the base lacks with the base carrier it moved from: the
 * one that left with the same bytes, else the only one that left under the same filename. A move
 * carries its carrier's debt back to the section it left, so moving a carrier is not new damage.
 */
function movedFrom(baseRows, candidateRows) {
  const candidatePaths = new Set(candidateRows.map(({ path }) => path));
  const basePaths = new Set(baseRows.map(({ path }) => path));
  const left = baseRows.filter(({ path }) => !candidatePaths.has(path));
  const byObject = new Map();
  const byName = new Map();
  for (const row of left) {
    byObject.set(row.object, [...(byObject.get(row.object) ?? []), row]);
    byName.set(posix.basename(row.path), [...(byName.get(posix.basename(row.path)) ?? []), row]);
  }
  const taken = new Set();
  const moves = new Map();
  const arrivals = candidateRows.filter(({ path }) => !basePaths.has(path));
  for (const pass of [(row) => byObject.get(row.object), (row) => byName.get(posix.basename(row.path))]) {
    for (const row of arrivals) {
      if (moves.has(row.path)) continue;
      const open = (pass(row) ?? []).filter((origin) => !taken.has(origin.path));
      if (open.length !== 1) continue;
      taken.add(open[0].path);
      moves.set(row.path, open[0]);
    }
  }
  return moves;
}

/**
 * The ratchet: each section's debts at `candidateRows` against `baseRows`. A section whose debt
 * rises, in any of `measures`, is a rise, and an integration with any rise is refused; a fall is
 * repair. Only live rows count, and a carrier that moved is counted in the section it left, so a
 * move refuses only the damage it does. Pure over two sets of census rows.
 * @param {ReadonlyArray<object>} baseRows
 * @param {ReadonlyArray<object>} candidateRows
 * @param {{scheme?: string, measures?: readonly string[]}} [options] restrict to one scheme
 */
export function ratchetCorpus(baseRows, candidateRows, { scheme = "", measures = RATCHET_MEASURES } = {}) {
  const moves = movedFrom(baseRows, candidateRows);
  const debts = new Map();
  const add = (section, side, row) => {
    if (row.stratum !== "live" || !inScheme(section, scheme)) return;
    const entry = debts.get(section) ?? { base: Object.fromEntries(measures.map((measure) => [measure, 0])), candidate: Object.fromEntries(measures.map((measure) => [measure, 0])) };
    for (const measure of measures) entry[side][measure] += LEDGER_MEASURES[measure](row);
    debts.set(section, entry);
  };
  for (const row of baseRows) add(row.section, "base", row);
  for (const row of candidateRows) add(moves.get(row.path)?.section ?? row.section, "candidate", row);
  const rises = [];
  const falls = [];
  for (const [section, { base, candidate }] of [...debts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    for (const measure of measures) {
      if (candidate[measure] > base[measure]) rises.push(Object.freeze({ section, measure, base: base[measure], candidate: candidate[measure] }));
      else if (candidate[measure] < base[measure]) falls.push(Object.freeze({ section, measure, base: base[measure], candidate: candidate[measure] }));
    }
  }
  return Object.freeze({ holds: rises.length === 0, moves: moves.size, rises: Object.freeze(rises), falls: Object.freeze(falls) });
}
