#!/usr/bin/env node
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import { gzipSync } from "node:zlib";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { parseArgv } from "@red-cup-engineering/javascript-node-services-section/argv";
import { moduleClosureDigest } from "@red-cup-engineering/javascript-node-services-section/module-closure";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { gitCommand, gitHistoryPlan, readIndexEntries, readOid, readPorcelainStatus, readTreeEntries, takeBatchRecord } from "@red-cup-engineering/git-services-section/git-command-codec";
import { gitBlobIdOf } from "@red-cup-engineering/git-services-section/git-object-id";
import { carrierFactsKey, censusCorpus, isCorpusCarrierPath, readBibtexKeys, readCarrierFacts } from "../src/corpus-census.mjs";
import { checkLedgerAssertions, measureScheme, parseLedgerAssertion, ratchetCorpus } from "../src/corpus-ledger.mjs";
import { deriveKnowledgeDebtReports } from "../src/knowledge-debt-reports.mjs";

const DEFAULT_OUT_DIR = "services/561-group-services-section/data/records/knowledge-census-records/corpus";
const VALUED = new Set(["root", "out-dir", "date", "revision", "section", "assert", "base", "cache-dir", "agency-root"]);
const FACTS_FILE = "facts.v8";

/** Where carrier facts are kept: `--cache-dir`, else `$XDG_CACHE_HOME/561-group/corpus-census`. */
function defaultCacheDirectory(environment = process.env) {
  return join(environment.XDG_CACHE_HOME || join(homedir(), ".cache"), "561-group", "corpus-census");
}

/**
 * Parse `--root <dir> [--revision <rev> | --worktree] [--out-dir <dir>] [--date YYYY-MM-DD]
 * [--section <scheme> [--only]] [--assert <measure><op><n>]... [--base <rev>] [--cache-dir <dir>]`.
 * With `--section`, `--assert` or `--base` the run is a check: it writes no record, prints the
 * verdict, and exits non-zero when an assertion fails or the ratchet finds a rise. `--only`
 * measures the scheme's own carriers, not those of the sections under it.
 * @param {string[]} argv
 */
export function parseCensusCorpusArgs(argv) {
  const { positionals, values } = parseArgv(argv, VALUED);
  if (positionals.length > 0) throw new TypeError(`unexpected argument ${positionals[0]}`);
  const one = (name) => {
    const value = values[name];
    if (Array.isArray(value)) throw new TypeError(`--${name} is given once`);
    if (value === true) throw new TypeError(`--${name} takes a value`);
    return value;
  };
  const root = one("root");
  if (typeof root !== "string" || root === "") throw new TypeError("--root is required");
  if (values.worktree !== undefined && values.revision !== undefined) throw new TypeError("--worktree and --revision name different candidates");
  const assertions = [values.assert ?? []].flat().map(parseLedgerAssertion);
  const base = one("base");
  const section = one("section");
  if (values.only !== undefined && (section === undefined || values.only !== true)) throw new TypeError("--only takes no value and needs --section");
  return {
    root,
    agencyRoot: one("agency-root"),
    outDir: one("out-dir") ?? posix.join(root, DEFAULT_OUT_DIR),
    date: one("date") ?? new Date().toISOString().slice(0, 10),
    revision: one("revision") ?? "HEAD",
    worktree: values.worktree === true,
    section: section ?? "",
    only: values.only === true,
    assertions,
    base,
    check: assertions.length > 0 || base !== undefined || section !== undefined,
    cacheDirectory: one("cache-dir") ?? defaultCacheDirectory(),
  };
}

/** The wanted queues (or the debt reports) as JSON with one entry per line, so a diff shows which demand moved. */
function renderWanted(wanted) {
  const queue = (entries) => (entries.length === 0 ? "[]" : `[\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(",\n")}\n ]`);
  const fields = Object.entries(wanted).map(([key, value]) => ` ${JSON.stringify(key)}: ${Array.isArray(value) ? queue(value) : JSON.stringify(value)}`);
  return `{\n${fields.join(",\n")}\n}\n`;
}

/** Run one house Git command plan in `cwd`, resolving its whole stdout as bytes. */
function runGit(plan, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(plan.command, plan.arguments, { cwd, env: { ...process.env, ...plan.environment } });
    const chunks = [];
    const errors = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", fail);
    child.on("close", (code) => (plan.ok.includes(code) ? done(Buffer.concat(chunks)) : fail(new Error(`git ${plan.arguments.join(" ")} exited ${code}: ${Buffer.concat(errors).toString().trim()}`))));
    child.stdin.end(plan.input ?? undefined);
  });
}

/** Read `objects` through one `cat-file --batch`, decoding each record as it streams in. */
function readBlobs(objects, cwd) {
  if (objects.length === 0) return Promise.resolve([]);
  const plan = gitHistoryPlan.blobs(objects);
  return new Promise((done, fail) => {
    const child = spawn(plan.command, plan.arguments, { cwd });
    const decoder = new TextDecoder();
    const texts = [];
    let pending = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      for (let record = takeBatchRecord(pending); record !== undefined; record = takeBatchRecord(pending)) {
        texts.push(record.body === undefined ? undefined : decoder.decode(record.body));
        pending = Buffer.from(record.rest);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 && texts.length === objects.length ? done(texts) : fail(new Error(`git cat-file read ${texts.length} of ${objects.length} objects (exit ${code})`))));
    child.stdin.end(plan.input);
  });
}

/** Where `root` sits in its repository: the repository's top and the root's path within it. */
async function locate(root) {
  const top = (await runGit(gitCommand(["rev-parse", "--show-toplevel"]), resolve(root))).toString().trim();
  return { top, prefix: posix.relative(top, resolve(root)) };
}

const commitOf = async (revision, top) => readOid((await runGit(gitCommand(["rev-parse", "--verify", `${revision}^{commit}`]), top)).toString());
const underRoot = (prefix) => (path) => prefix === "" || path.startsWith(`${prefix}/`);
const rootRelative = (prefix) => (path) => (prefix === "" ? path : path.slice(prefix.length + 1));

/** The files `commit` tracks under the root, each with its blob, read from one `ls-tree`. */
async function revisionFiles({ top, prefix, commit }) {
  const listing = await runGit(gitCommand(["-c", "core.quotepath=off", "ls-tree", "-r", "-z", "--full-tree", commit, "--", prefix || "."]), top);
  const relative = rootRelative(prefix);
  return readTreeEntries(listing.toString()).filter(({ type }) => type === "blob").map(({ path, object }) => ({ path: relative(path), object }));
}

/**
 * The files under the root as `git add -A` would commit them: the index, with every path the
 * worktree changes read from disk instead (and its blob computed), every untracked file Git does
 * not ignore added, and every deleted one dropped.
 */
async function worktreeFiles({ top, prefix }) {
  const pathspec = ["--", prefix || "."];
  const [staged, changed] = await Promise.all([
    runGit(gitCommand(["ls-files", "--stage", "-z", ...pathspec]), top),
    runGit(gitCommand(["-c", "core.fileMode=false", "status", "--porcelain=v1", "-z", "--untracked-files=all", ...pathspec]), top),
  ]);
  const index = readIndexEntries(staged.toString());
  const status = readPorcelainStatus(changed.toString());
  const files = new Map();
  for (const { path, mode, object } of index) if (mode !== "160000" && !files.has(path)) files.set(path, { path, object });
  for (const { path, source } of status) {
    if (source !== undefined) files.delete(source);
    let bytes;
    try {
      const stat = lstatSync(join(top, path));
      if (stat.isSymbolicLink()) bytes = Buffer.from(readlinkSync(join(top, path)));
      else if (stat.isFile()) bytes = readFileSync(join(top, path));
    } catch { bytes = undefined; }
    if (bytes === undefined) files.delete(path);
    else files.set(path, { path, object: gitBlobIdOf(bytes), text: new TextDecoder().decode(bytes) });
  }
  const inside = underRoot(prefix);
  const relative = rootRelative(prefix);
  return [...files.values()].filter(({ path }) => inside(path)).map((file) => ({ ...file, path: relative(file.path) }));
}

/**
 * Carrier facts kept on disk by the code that read them: a store under `directory/<closure>`,
 * where closure digests the module graph of the facts reader, so a change to any code the facts
 * depend on starts a fresh store and retires the others, and a change to resolution keeps it.
 * Saving keeps only what this run used.
 */
function openFactsStore(directory) {
  const closure = moduleClosureDigest([new URL("../src/carrier-facts.mjs", import.meta.url)]).digest;
  const file = join(directory, closure, FACTS_FILE);
  let facts;
  try { facts = deserialize(readFileSync(file)); } catch { facts = new Map(); }
  if (!(facts instanceof Map)) facts = new Map();
  const used = new Set();
  let read = 0;
  return {
    get(key) { used.add(key); return facts.get(key); },
    set(key, value) { used.add(key); facts.set(key, value); read += 1; },
    get read() { return read; },
    save() {
      if (read === 0) return;
      for (const key of facts.keys()) if (!used.has(key)) facts.delete(key);
      mkdirSync(join(directory, closure), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, serialize(facts));
      renameSync(temporary, file);
      for (const entry of readdirSync(directory)) if (entry !== closure) rmSync(join(directory, entry), { recursive: true, force: true });
    },
  };
}

const bibtexKey = (object) => `bibtex\u0000${object}`;
const isBibtexPath = (path) => path.endsWith(".bib") && !path.split("/").includes("node_modules");

/**
 * Every snapshot's carriers and BibTeX files with their facts: from the store when it holds them,
 * else read from the text the snapshot carries or from one `cat-file --batch` over every blob
 * still missing, across all snapshots at once.
 */
async function withFacts(snapshots, store, top) {
  const missing = new Map();
  const keyed = snapshots.map((files) => files.filter(({ path }) => isCorpusCarrierPath(path) || isBibtexPath(path)).map((file) => {
    const key = isBibtexPath(file.path) ? bibtexKey(file.object) : carrierFactsKey(file.path, file.object);
    if (store.get(key) === undefined && !missing.has(key)) missing.set(key, file);
    return { ...file, key };
  }));
  const unread = [...missing.values()].filter(({ text }) => text === undefined);
  const texts = await readBlobs(unread.map(({ object }) => object), top);
  const read = new Map(unread.map(({ object }, index) => [object, texts[index] ?? ""]));
  for (const [key, file] of missing) {
    const text = file.text ?? read.get(file.object);
    store.set(key, isBibtexPath(file.path) ? readBibtexKeys(text) : readCarrierFacts({ path: file.path, text }));
  }
  return snapshots.map((files, index) => ({
    paths: files.map(({ path }) => path),
    documents: keyed[index].filter(({ path }) => isCorpusCarrierPath(path)).map(({ path, object, key }) => ({ path, object, facts: store.get(key) })),
    bibtex: keyed[index].filter(({ path }) => isBibtexPath(path)).map(({ path, key }) => ({ path, keys: store.get(key) })),
  }));
}

/**
 * Census every carrier `revision` tracks under `root` and write the dated census record, the
 * current per-carrier rows, and the current wanted queue under `outDir`.
 * @param {ReturnType<typeof parseCensusCorpusArgs>} options
 */
export async function censusCorpusAtRevision({ root, outDir, date, revision, agencyRoot, cacheDirectory = defaultCacheDirectory() }) {
  const { top, prefix } = await locate(root);
  const commit = await commitOf(revision, top);
  const store = openFactsStore(cacheDirectory);
  const [snapshot] = await withFacts([await revisionFiles({ top, prefix, commit })], store, top);
  const { record, table, wanted, rows } = censusCorpus({ commit, date, ...snapshot });
  store.save();
  // The assay runs at the repository top, naming this script and the root from there.
  const fromTop = (file) => relative(top, resolve(file)).split("\\").join("/");
  const reports = deriveKnowledgeDebtReports(rows, { commit, date, directory: top, script: fromTop(fileURLToPath(import.meta.url)), root: prefix || ".", census: fromTop(posix.join(outDir, "census")), agencyRoot: fromTop(agencyRoot ?? join(top, "lib")) || "." });
  const recordPath = posix.join(outDir, "census", `${date}.json`);
  await writeFileText(recordPath, `${JSON.stringify(record, null, 1)}\n`);
  await writeFile(posix.join(outDir, "rows.tsv.gz"), gzipSync(table, { level: 9 }));
  await writeFileText(posix.join(outDir, "wanted.json"), renderWanted(wanted));
  await writeFileText(posix.join(outDir, "reports.json"), renderWanted(reports));
  return { recordPath, headline: record.headline, reports: { sections: reports.sections, debt: reports.debt, sectionsHoldingNinetyPercent: reports.sectionsHoldingNinetyPercent } };
}

/**
 * Check a candidate (a revision, or the worktree as it would be committed) against the ledger:
 * each assertion over the scheme's live measures, and, with `base`, the ratchet over every section
 * of the scheme against the commit where the candidate forked from `base` (as `git diff
 * <base>...` reads it), so work on main since the fork is not the candidate's. Writes nothing but
 * the facts store. Resolves the verdict; `holds` is false on a failed assertion or any rise.
 * @param {ReturnType<typeof parseCensusCorpusArgs>} options
 */
export async function checkCorpusLedger({ root, date, revision, worktree, section, only = false, assertions, base, cacheDirectory }) {
  const { top, prefix } = await locate(root);
  const commit = await commitOf(worktree ? "HEAD" : revision, top);
  const fork = base === undefined ? undefined : readOid((await runGit(gitCommand(["merge-base", await commitOf(base, top), commit]), top)).toString());
  const store = openFactsStore(cacheDirectory);
  const [candidateFiles, baseFiles] = await Promise.all([
    worktree ? worktreeFiles({ top, prefix }) : revisionFiles({ top, prefix, commit }),
    fork === undefined ? undefined : revisionFiles({ top, prefix, commit: fork }),
  ]);
  const [candidate, baseline] = await withFacts(baseFiles === undefined ? [candidateFiles] : [candidateFiles, baseFiles], store, top);
  const candidateRows = censusCorpus({ commit, date, ...candidate }).rows;
  const measures = measureScheme(candidateRows, section, { only });
  const checked = checkLedgerAssertions(measures, assertions);
  const ratchet = baseline === undefined ? undefined : ratchetCorpus(censusCorpus({ commit: fork, date, ...baseline }).rows, candidateRows, { scheme: section });
  store.save();
  return Object.freeze({
    holds: checked.every(({ holds }) => holds) && (ratchet?.holds ?? true),
    candidate: { commit, worktree },
    ...(fork === undefined ? {} : { base: { revision: base, fork } }),
    scheme: section,
    ...(only ? { only } : {}),
    measures,
    assertions: checked,
    ...(ratchet === undefined ? {} : { ratchet }),
    factsRead: store.read,
  });
}

if (isMain(import.meta.url)) {
  const options = parseCensusCorpusArgs(process.argv.slice(2));
  if (options.check) {
    const verdict = await checkCorpusLedger(options);
    process.stdout.write(`${JSON.stringify(verdict, null, 1)}\n`);
    if (!verdict.holds) process.exitCode = 1;
  } else {
    const { recordPath, headline, reports } = await censusCorpusAtRevision(options);
    process.stdout.write(`${JSON.stringify(headline)}\n${JSON.stringify(reports)}\nwrote: ${recordPath}\n`);
  }
}
