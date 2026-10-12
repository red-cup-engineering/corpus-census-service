/**
 * The knowledge ledger's Plan step: each owning section's ratchet debt posted as an open signal,
 * never allocated. A section's micro-enterprise (or any whose taking policy admits it) takes the
 * signal into its own root; the ledger's own assertion over that section's carriers is the assay.
 *
 * One signal per section, because the section's live carriers are the write set: two sections'
 * signals commute, and the debts within one section conflict. Each nonzero debt is one work item
 * whose acceptance is `census-corpus --section <s> --only --assert <measure><=0`, which fails at
 * the commit the signal was derived from, so every item names real work.
 *
 * Signals are content-addressed by what they ask, not by the counts measured, so deriving again
 * while a section's debts persist yields the same signal; the counts travel beside it. The ledger
 * keeps its standing on the board by reconciling each derivation against what it has posted: new
 * demand is posted, repaired demand a taker offered a result for is accepted (the derivation is the
 * assay), and repaired or superseded demand nobody resulted is withdrawn.
 * @packageDocumentation
 */
import { posix } from "node:path";
import { signalOf } from "@red-cup-engineering/organizing/enterprise";
import { measureScheme, RATCHET_MEASURES } from "./corpus-ledger.mjs";

/** The micro-enterprise that holds the ledger and posts what it measures. */
export const KNOWLEDGE_LEDGER_ENTERPRISE = "corpus-knowledge-ledger";
export const KNOWLEDGE_WORK_SIGNALS_KIND = "computer-corpus-knowledge-signals.v1";
const PRODUCER = Object.freeze({ id: "derive-knowledge-work-signals", revision: "0.1.0" });
const ENDEAVOR = "endeavor:corpus-knowledge-graph";
const CAMPAIGN = "campaign:corpus-knowledge-graph/ratchet-debt";

/** Each ratchet debt: its work item's name, the program workstream that repairs it, and what it is. */
const DEBTS = Object.freeze({
  brokenLinks: Object.freeze({ name: "broken-links", work: "link-repair", what: "path links that name no tracked file" }),
  unresolvedWikilinks: Object.freeze({ name: "unresolved-wikilinks", work: "link-repair", what: "wikilinks that resolve to no carrier (write the page or repair the link)" }),
  unlawfulCitekeys: Object.freeze({ name: "unlawful-citekeys", work: "lawful-depth-1-citation", what: "citekeys outside the citing carrier's own references map" }),
  refusals: Object.freeze({ name: "refusals", work: "schema-admission", what: "carriers their schema's owner refuses" }),
});

/** A section's name in work scopes: its path without the `services/` steps (an app keeps its
 *  `apps/` step, so it never reads like a section of the same name). */
export function sectionScopeName(section) {
  return section === "" ? "root" : section.replace(/(^|\/)services\//gu, "$1");
}

/**
 * Derive the ledger's signals from one census: one per live section carrying ratchet debt,
 * largest debt first.
 * @param {ReadonlyArray<object>} rows the census rows at `commit`
 * @param {{commit: string, date: string, directory: string, script: string, root: string,
 *   census: string, poster?: string}} options `directory` is the absolute repository top where
 *   the assay runs; `script` (the census script), `root` (the corpus root) and `census` (the
 *   directory of dated census records, the signals' provenance) are relative to it
 */
export function deriveKnowledgeWorkSignals(rows, { commit, date, directory, script, root, census, poster = KNOWLEDGE_LEDGER_ENTERPRISE }) {
  if (!posix.isAbsolute(directory)) throw new TypeError("the assay directory is absolute");
  if (typeof census !== "string" || census === "") throw new TypeError("the census records' directory is named");
  const sections = [...new Set(rows.filter((row) => row.stratum === "live").map((row) => row.section))].sort();
  const derived = [];
  for (const section of sections) {
    const measures = measureScheme(rows, section, { only: true });
    const owed = RATCHET_MEASURES.filter((measure) => measures[measure] > 0);
    if (owed.length === 0) continue;
    const debt = Object.fromEntries(owed.map((measure) => [measure, measures[measure]]));
    derived.push(Object.freeze({ section, total: owed.reduce((sum, measure) => sum + debt[measure], 0), debt: Object.freeze(debt), signal: signalOfSection({ section, owed, poster, directory, script, root, census, date }) }));
  }
  derived.sort((left, right) => right.total - left.total || left.section.localeCompare(right.section));
  const total = derived.reduce((sum, entry) => sum + entry.total, 0);
  let running = 0;
  const head = derived.findIndex((entry) => (running += entry.total) >= 0.9 * total) + 1;
  return Object.freeze({
    kind: KNOWLEDGE_WORK_SIGNALS_KIND,
    commit,
    date,
    poster,
    measures: RATCHET_MEASURES,
    debt: total,
    sections: derived.length,
    sectionsHoldingNinetyPercent: head,
    signals: Object.freeze(derived),
  });
}

function signalOfSection({ section, owed, poster, directory, script, root, census, date }) {
  const name = sectionScopeName(section);
  const source = "census";
  const provenance = Object.freeze([Object.freeze({ source })]);
  const chain = (cell, parent, text) => Object.freeze({ cell, ...(parent === undefined ? {} : { parent }), text, evidence: [], provenance });
  const project = `project:knowledge-debt/${name}`;
  const plan = `plan:knowledge-debt/${name}`;
  const task = `task:knowledge-debt/${name}`;
  const items = owed.map((measure) => `work-item:knowledge-debt/${name}/${DEBTS[measure].name}`);
  return signalOf({
    poster,
    assayer: poster,
    tags: Object.freeze(["knowledge-debt", `section:${section}`, ...owed.map((measure) => DEBTS[measure].name)]),
    postedAt: `${date}T00:00:00.000Z`,
    intent: Object.freeze({
      kind: "metroplat.work.structured-intent",
      id: `knowledge-debt:${name}`,
      producer: PRODUCER,
      sources: Object.freeze([Object.freeze({ id: source, kind: "corpus-census", locator: census })]),
      items: Object.freeze([
        chain(ENDEAVOR, undefined, "The corpus knowledge graph: every carrier admitted, linked, cited, dereferenceable and searchable."),
        chain(CAMPAIGN, ENDEAVOR, "Repair the debts the integration ratchet holds, section by section, by the sections that own them."),
        chain(project, CAMPAIGN, `The knowledge debt of ${section || "the corpus root"}'s own live carriers.`),
        chain(plan, project, "Bring each debt the ledger measures here to zero; the ratchet keeps it there."),
        chain(task, plan, `Repair the carriers of ${section || "the corpus root"}, writing no other section's carriers.`),
        ...owed.map((measure, index) => Object.freeze({
          cell: items[index],
          parent: task,
          ...(owed.length > 1 ? { conflicts: items.filter((_, other) => other !== index) } : {}),
          text: `No live carrier of ${section || "the corpus root"} itself has ${DEBTS[measure].what}.`,
          work: DEBTS[measure].work,
          deterministicExecution: Object.freeze({
            operation: "census-corpus",
            request: Object.freeze({
              type: "JavascriptNodeCommandExecutionRequest",
              version: 1,
              command: "node",
              arguments: Object.freeze([script, "--root", root, "--section", section, "--only", "--assert", `${measure}<=0`]),
              directory,
              environment: null,
              input: null,
            }),
            acceptance: Object.freeze({ kind: "command-exit-status", status: 0 }),
          }),
          evidence: [],
          provenance,
        })),
      ]),
    }),
  });
}

/**
 * What the ledger does on a board to stand where a derivation says: post each derived signal the
 * board lacks; for each of its own signals still standing that the derivation no longer asks,
 * accept the first taker's result when one was offered (the debt measured zero, so the assay
 * holds), else withdraw it. Signals other posters hold are not the ledger's to touch.
 * @param {ReadonlyArray<{signal: {id: string, poster: string}, standing: string, resulted: ReadonlyArray<string>}>} board
 * @param {{poster: string, signals: ReadonlyArray<{signal: {id: string}}>}} derivation
 */
export function reconcileKnowledgeSignals(board, derivation) {
  const asked = new Set(derivation.signals.map((entry) => entry.signal.id));
  const own = board.filter((entry) => entry.signal.poster === derivation.poster);
  const posted = new Set(own.map((entry) => entry.signal.id));
  const settled = own.filter((entry) => !asked.has(entry.signal.id) && (entry.standing !== "accepted" && entry.standing !== "withdrawn"));
  return Object.freeze({
    post: Object.freeze(derivation.signals.map((entry) => entry.signal).filter((signal) => !posted.has(signal.id))),
    accept: Object.freeze(settled.filter((entry) => entry.resulted.length > 0).map((entry) => Object.freeze({ signal: entry.signal.id, enterprise: entry.resulted[0] }))),
    withdraw: Object.freeze(settled.filter((entry) => entry.resulted.length === 0).map((entry) => Object.freeze({ signal: entry.signal.id, reason: "the ledger no longer measures this debt" }))),
  });
}
