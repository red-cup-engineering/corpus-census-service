# @red-cup-engineering/corpus-census-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

The corpus admission ledger: one census of every content carrier a revision tracks, so the 561 Group can see the state of its whole knowledge corpus, not only its glossaries, in one record.
It is waves 1.1 and 1.5 of [the corpus knowledge graph program](../../../../../../../../../science-services-section/services/information-science-services-section/services/knowledge-services-section/services/knowledge-organization-services-section/content/text/documents/articles/notes/2026/09/30/2026-09-30-the-corpus-knowledge-graph-program.md).
The [glossary census](../computer-glossary-systems-engineering-services-section/services/glossary-census-service/README.md) is the glossary-only case it generalizes.

Owners judge and this service counts.
Term carriers are admitted by [term-engineering](../computer-glossary-systems-engineering-services-section/services/term-engineering-services-section/README.md), bibliography carriers by [bibliography-engineering](../bibliography-engineering-services-section/README.md), and every other kind with a schema by [carrier-kind-engineering](../carrier-kind-engineering-services-section/README.md).
Links, wikilinks and citations are read by markdown-engineering's feature reader and wikilink resolver.

## What counts as a carrier

Every `.md` and `.org` file the revision tracks under the root is a carrier, except under `node_modules`, `dist`, `test`, `tests`, or `fixtures`.
A carrier under a `lib`, `legacy`, `triage`, `recovered`, `_archive`, or `lenticule-import` directory is in the `archive` stratum, the evidence the corpus grew from.
Every other carrier is `live`.

## Per-carrier fields

- **Section.**
  The deepest `services/<name>` or `apps/<name>` directory above the carrier: its concept scheme, as for a glossary term.
- **Identity.**
  The filename stem, so the IRI is `https://561.group/knowledge/<section path without services/>/<stem>`, the same rule the SKOS vocabulary uses.
  Two live carriers that share a section and stem make the IRI ambiguous; both rows say so.
- **Kind.**
  Read from the artifact-role directory: the first directory past `content/text/documents/articles/glossary/media`, with plurals made singular (`glossary/terms` gives `term`, `articles/notes/2026/09/30` gives `note`).
  Section, role and kind are carrier-kind-engineering's `./carrier-path`, so the census and the admitter read one rule.
  A file directly in its section is a `readme`, `agents`, `changelog`, or `claude` by name, and otherwise a `document`.
- **Frontmatter and visibility.**
  Frontmatter is `yaml`, `toml`, `none`, `malformed`, or (for Org) `org-header`.
  `public` is true only when the house surface policy admits the carrier: `visibility: public` and no `consent-status`.
- **Schema.**
  `term` for `content/text/glossary/terms/*.md` and `bibliography` for `bibliographies/*.md`.
  Any other Markdown carrier whose kind has a carrier-kind schema is claimed by it (`note` today), and malformed frontmatter adds the rule `frontmatter-malformed`.
  Each row carries the owner's admission verdict and refusal rules.
  Any other carrier is `none` until its kind has a schema.
- **Links.**
  A relative or root-anchored link is `resolved` when it names a tracked file or directory (or a file once `.md` is implied).
  It is `escaped` when it leaves the root and `broken` otherwise.
  Web links are `external`, other URI schemes `scheme`, and bare fragments `same-document`.
- **Wikilinks.**
  Resolved corpus-wide by basename or `aliases` with the shortest-unique-path rule.
  The verdict is `resolved`, `ambiguous`, `unresolved`, `self`, or `external`.
- **Citekeys.**
  A bracketed `[@key]` is `resolved` when the carrier's own `references:` map holds the key.
  It is `covered` when only another carrier's map, a bibliography carrier, or a `.bib` file knows it, and `unknown` when nothing does.
  Every citekey that is not `resolved` is `unlawful`: the citation rule admits only keys the citing carrier's own map holds.

Org carriers are counted with their header, but their links are not read yet.

## Outputs

`scripts/census-corpus.mjs` (bin `census-corpus`, `--root <dir> [--out-dir <dir>] [--date YYYY-MM-DD] [--revision <rev>] [--cache-dir <dir>] [--agency-root <dir>]`) reads the revision through the house Git codec (`ls-tree`, then one `cat-file --batch`), never the working tree, and writes four files.
`--agency-root` names the address basis for section reports and defaults to the repository's `lib/`; the corpus must lie inside it. An independent repository census can explicitly select its own root as the agency root.
`--out-dir` defaults to `services/561-group-services-section/data/records/knowledge-census-records/corpus/`.

- `census/<date>.json` (`computer-corpus-census.v1`).
  The dated record holds the commit, a headline, and per-stratum totals.
  The totals cover frontmatter, visibility, schema admission, refusal rules, link, wikilink and citekey verdicts, kinds and stated types.
  It also holds live rollups per section two levels down (`services/<a>/services/<b>`).
- `rows.tsv.gz`.
  One row per carrier with the columns `CORPUS_ROW_COLUMNS` names, gzip-compressed and read with `zcat`.
  It is a derived payload, so Git ignores it (the repository keeps records, not bulk payloads).
  The census record names its row count, columns and the SHA-256 of the uncompressed table, so rows derived again at the recorded commit can be checked against it.
- `wanted.json` (`computer-corpus-wanted.v1`).
  The authorship-demand queue from live carriers, one entry per line, ranked by distinct referrers with up to three sample referrers.
  `pages` lists unresolved wikilink targets (pages someone linked and nobody wrote).
  `references` lists unknown citekeys.
  `paths` lists broken link targets named by at least three carriers; the rest are counted in `unlistedPaths`.
  `pages[].target` is an unresolved *literal source wikilink*, `references[].citekey` is an unresolved citation identifier, and `paths[].path` is a source path claim. None of these is independently a newly admitted glossary Concept, an authorized content-creation request, or proof that a page is missing in a different repository. The source contains a dated revision and sample referrers, not a claim about the live installed reader. GitHub's standard Contents endpoint can omit inline content for an artifact over 1 MiB; retrieve its actual Git blob rather than treating an empty inline body as an empty/unused resource. Original producer: `censusCorpusAtRevision` in this package. Selection by an actual, authorized downstream authorship or knowledge-work consumer still requires independent evidence.
- `reports.json` (`computer-corpus-knowledge-debt-reports.v1`).
  The knowledge ledger's nonconformity reports under `openings`, one per live section whose own carriers carry ratchet debt, largest debt first, one entry per line.
  Each entry holds the section, its debt per measure and total, and the report itself; the record also names the commit, the law, the total debt and how many sections hold 90% of it.
  See [Reports, not demands](#reports-not-demands).

## The facts store

What a carrier says (its frontmatter, schema verdict, link, wikilink and citekey targets) depends only on its bytes, its extension, the schema that claims it and, for a term or bibliography carrier, its filename.
`src/carrier-facts.mjs` reads those facts, and the script keeps them in a v8-serialized map keyed by `carrierFactsKey(path, object)`, the blob id plus those.
The store lives under `--cache-dir` (default `$XDG_CACHE_HOME/561-group/corpus-census`, else `~/.cache/561-group/corpus-census`), in a directory named for the module closure digest of `carrier-facts.mjs`.
A change to the code that reads facts therefore starts a fresh store, and the stale ones are pruned.
Each run keeps only the keys it used, and resolution (links, wikilinks, citekeys) always runs again over the whole corpus, since it depends on what else exists.
On the full house corpus a cold run takes about 45 s and a warm one 7 to 9 s.

## The ledger and the ratchet

`src/corpus-ledger.mjs` is pure over census rows.
`LEDGER_MEASURES` names what can be counted over a scheme's live rows: carriers, links, `brokenLinks`, wikilinks, `unresolvedWikilinks`, `ambiguousWikilinks`, citekeys, `unlawfulCitekeys`, `unknownCitekeys`, `refusals` (schema'd carriers their owner refuses), `unschematized`, `frontmatterless`, `malformedFrontmatter`, `public` and `ambiguousIdentities`.
A work item's acceptance is an assertion over one of them.

The ratchet holds the four debts in `RATCHET_MEASURES` (broken path links, unresolved wikilinks, unlawful citekeys and schema refusals) per section.
A candidate is refused when any section's live debt rises over the base, even a section the candidate did not touch, because deleting a carrier breaks the links to it elsewhere.
Repair in one section does not pay for damage in another.
A carrier at a new path is paired with the base carrier it moved from (the same blob, else the only departed carrier with its filename) and counted in the section it left, so a move is refused only for the damage it does.

Any of `--section <scheme>` (with `--only`, the scheme's own carriers and not those of the sections under it), `--assert <measure><op><n>` (repeatable; op `<=`, `>=`, `<`, `>` or `=`) or `--base <rev>` turns the script into a check.
It prints a JSON verdict (`holds`, the candidate and the base's fork point, the scheme's measures, each assertion, and the ratchet's rises, falls and moves), writes no record, and exits 1 when the verdict does not hold.
The candidate is `--revision` (default `HEAD`), or with `--worktree` the working tree as `git add -A` would commit it, untracked files included.
The base is the fork point, `merge-base(<rev>, candidate)`, as `git diff <rev>...` reads it.

The computer code development engine's `duty-worktree-check` runs `--worktree --base refs/remotes/origin/main` over the house corpus whenever a duty's work changes a path under it, and the check fails when the ratchet does.

## Reports, not demands

The 561 Group runs as Rendanheyi micro-enterprises, each holding its own work ([micro-enterprises hold their own work](../../../../../../../../../561-group-services-section/content/text/documents/articles/notes/2026/09/30/2026-09-30-note-on-micro-enterprises-holding-their-own-work.md)), and work between them is a concurrent game ([the 2026-10-01 note](../../../../../../../../../561-group-services-section/content/text/documents/articles/notes/2026/10/01/2026-10-01-note-on-work-between-micro-enterprises-as-a-concurrent-game.md)).
A measurement finds a law broken; it does not demand work (the work arena's sixth edition, note 2026-10-02).
So the ledger reports each indebted section on the settlement's work board as a nonconformity, and the micro-enterprise whose territory holds the section adopts it into its own root and restores the law by a method it chooses and staffs.
The reporter is the `corpus-knowledge-ledger` node micro-enterprise (record in the knowledge organization section, staffed by its knowledge systems architect office).

`src/knowledge-debt-reports.mjs` is pure over census rows.
`deriveKnowledgeDebtReports(rows, { commit, date, directory, script, root, census, agencyRoot })` yields one report (`organizing/enterprise` `openingOf`) per section.
The section's own live carriers are the write set, so two sections' reports commute and the debts within one section conflict.
The report's law is the ratchet's (`RATCHET_LAW`) and its subject is `section:<path>`, so it is that condition's one thread on the board, however often it is measured: the counts travel in its observation. Each derivation entry keeps the command that re-reads it (`reread`: `census-corpus --root <root> --section <s> --only --assert <measure><=0`, run in `directory`), because verifying a repair is the ledger's own measurement.
Its evidence is the dated census record.
Tags are `knowledge-debt` and the owed debts' names; scope is the section and `project:knowledge-debt/<name>`, which routes it home.

The ledger's enterprise record names `reports.json` under `derives`, so its own loop keeps the board where the latest derivation says, through organizing `reconcileDerivedOpenings`.
The declared loop is intended to report each derived nonconformity the board lacks, resolve its own reports the derivation no longer finds, and corroborate a resolved condition it finds again. A repair is verified by measuring, never by its doer's word; a source-declared loop is not by itself independent evidence that the original installed Work Arena has selected or executed the `reconcileDerivedOpenings` operation.
It never touches threads other players opened.
A derivation reaches the loop when its commit is released.

## The pure core

`src/corpus-census.mjs` exports the pure core `censusCorpus({ commit, date, paths, documents, bibtex })`, which reads no filesystem and yields byte-identical output for the same snapshot.
A document is `{ path, object, text }` or, from the facts store, `{ path, object, facts }`; a `.bib` file is `{ path, text }` or `{ path, keys }`.

## Original Git source custody assays

Use the **pure** [source custody assay](src/source-custody.mjs) over three independently acquired, complete, immutable Git provider tree cuts to compare one original archive, one legacy projection, and the current Science home. This extends the existing corpus census; it is not a second archive, an index, an owner registry, a content-grant API, or an automatic Git deleter.

Source contract: [input JSON Schema Draft 2020-12](data/schemas/source-custody-input.schema.json). An authorized source acquirer supplies an object with original, legacy, and canonical, each being a source cut named by repository, exact revision Git object ID, prefix, coverage set to "complete", and relative-path Git blob entries. Different filenames in the canonical subtree are intentionally resolved by **blob SHA**, not by guesses about a mathematical proof path. An incomplete cut, repeated name, unsafe path or malformed OID **refuses**. The result follows the independently versioned [output JSON Schema](data/schemas/source-custody-output.schema.json).

A source-obtaining, source-authorized host may import the package subpath **@red-cup-engineering/corpus-census-service/source-custody** and call assaySourceCustody(packet), or provide that **already received** packet via standard input:

    node scripts/assay-source-custody.mjs < source-cuts.json

The CLI is bounded to 16 MiB of input, reads no directories or network, modifies no repositories, and returns deterministic, sorted evidence rows. Its byte classes distinguish exact-three-way, equal-historical-only, different-historical-bytes, original-only, and legacy-only. A matching Git blob demonstrates byte identity **only**. Whether the current mathematical repository is the correct conceptual owner, whether an archived file contains a proved theorem, whether copies can be retired without broken inbound links, whether an Actor may read source material, and whether an installed L-Space receiver has admitted it are separate conditions requiring their own evidence.

Original source demonstration: [Lenticule Science Predication Categories crosswalk](https://github.com/lenticule-science/561-theory-science-services-section/blob/main/humanities/theories/math/theories/categories/theories/predication-categories/computations/data/predication-archive-crosswalk.json) preserves the original Austin–Searle and 169 other migrated manuscript Git blob identities, along with the nine retained differing readings. The Science source crosswalk is **not copied here**: the source owner retains the typed records, while this engineering operation supplies the deterministic comparison for future revisions. The current [L-Space receiving work](https://github.com/lenticule-science/l-space.561.group/issues/5) remains responsible for original source/NI authorization, SignCraft/CAIRN graph presentation and independently witnessed browser/Actor readback. Source merges and this executable alone do not fulfill it.

Native controls: node --test test/source-custody.test.mjs tests speech-act source paths, input-order determinism, missing canonical owner, duplicate canonical byte peers, incomplete/forged cuts, unsafe paths, CLI source refusal and published schema surfaces. The source module uses no external runtime dependencies, so its tests can be independently run under Node's native test runner. New schema and source exports in the repository are **source candidates** until the original immutable release is published and installed; the existing 0.1.2 lock and dependency graph are unchanged.
