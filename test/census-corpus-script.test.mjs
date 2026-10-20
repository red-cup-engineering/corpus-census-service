import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/census-corpus.mjs", import.meta.url));
const GIT_ENVIRONMENT = { GIT_AUTHOR_NAME: "census", GIT_AUTHOR_EMAIL: "census@example.org", GIT_COMMITTER_NAME: "census", GIT_COMMITTER_EMAIL: "census@example.org", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const A = "services/a-section/README.md";
const B = "services/b-section/README.md";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "corpus-ratchet-"));
  const git = (...arguments_) => execFileSync("git", arguments_, { cwd: root, env: { ...process.env, ...GIT_ENVIRONMENT } }).toString().trim();
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const commit = (message) => { git("add", "-A"); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD"); };
  git("init", "-q", "--initial-branch=main");
  write(A, "# A\n\nSee [b](../b-section/README.md) and [gone](gone.md).\n");
  write(B, "# B\n\nSee [a](../a-section/README.md).\n");
  const base = commit("base");
  const census = (...arguments_) => {
    const run = spawnSync(process.execPath, [SCRIPT, "--root", root, "--cache-dir", join(root, ".cache"), ...arguments_], { env: { ...process.env, ...GIT_ENVIRONMENT } });
    return { status: run.status, verdict: run.status === 0 || run.status === 1 ? JSON.parse(run.stdout.toString()) : run.stderr.toString() };
  };
  return { root, git, write, commit, base, census, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("the ratchet refuses a commit adding a broken link to a section and admits one removing one", (t) => {
  const repository = fixture();
  t.after(repository.done);
  repository.write(".gitignore", ".cache/\n");
  repository.write(B, "# B\n\nSee [a](../a-section/README.md) and [lost](lost.md).\n");
  const damaging = repository.commit("damage");
  const refused = repository.census("--revision", damaging, "--base", repository.base);
  assert.equal(refused.status, 1);
  assert.deepEqual(refused.verdict.ratchet.rises, [{ section: "services/b-section", measure: "brokenLinks", base: 0, candidate: 1 }]);
  assert.equal(refused.verdict.base.fork, repository.base);

  repository.git("reset", "-q", "--hard", repository.base);
  repository.write(A, "# A\n\nSee [b](../b-section/README.md).\n");
  const repairing = repository.commit("repair");
  const admitted = repository.census("--revision", repairing, "--base", repository.base);
  assert.equal(admitted.status, 0);
  assert.deepEqual(admitted.verdict.ratchet.falls, [{ section: "services/a-section", measure: "brokenLinks", base: 1, candidate: 0 }]);
  assert.ok(admitted.verdict.factsRead > 0);
  assert.equal(repository.census("--revision", repairing, "--base", repository.base).verdict.factsRead, 0, "a second run reads no carrier again");
});

test("the worktree is checked as it would be committed, and assertions bound a section", (t) => {
  const repository = fixture();
  t.after(repository.done);
  repository.write(".gitignore", ".cache/\n");
  repository.commit("ignore the cache");
  repository.write("services/b-section/notes/new.md", "# New\n\n[[nothing written]]\n");
  const untracked = repository.census("--worktree", "--base", "main");
  assert.equal(untracked.status, 1, "an untracked carrier counts, as `git add -A` would commit it");
  assert.deepEqual(untracked.verdict.ratchet.rises, [
    { section: "services/b-section", measure: "unresolvedWikilinks", base: 0, candidate: 1 },
    { section: "services/b-section", measure: "refusals", base: 0, candidate: 1 },
  ], "a note with no frontmatter is refused by the note schema");
  rmSync(join(repository.root, "services/b-section/notes"), { recursive: true });
  rmSync(join(repository.root, B));
  const deleted = repository.census("--worktree", "--base", "main");
  assert.deepEqual(deleted.verdict.ratchet.rises, [{ section: "services/a-section", measure: "brokenLinks", base: 1, candidate: 2 }], "a deleted carrier breaks the links to it");
  repository.git("checkout", "-q", "--", B);

  const bounded = repository.census("--section", "services/a-section", "--assert", "brokenLinks<=0", "--assert", "carriers=1");
  assert.equal(bounded.status, 1);
  assert.deepEqual(bounded.verdict.assertions, [{ assertion: "brokenLinks<=0", measured: 1, holds: false }, { assertion: "carriers=1", measured: 1, holds: true }]);
  assert.equal(repository.census("--section", "services/b-section", "--assert", "brokenLinks<=0").status, 0);
});

test("the original census writes typed nonconformity reports, separate from its authorship-demand JSON", (t) => {
  const repository = fixture();
  t.after(repository.done);
  repository.write(".gitignore", ".cache/\nrecords/\n");
  repository.commit("ignore the cache and records");
  const run = spawnSync(process.execPath, [
    SCRIPT, "--root", repository.root, "--out-dir", join(repository.root, "records"),
    "--date", "2026-10-01", "--cache-dir", join(repository.root, ".cache"),
  ], { env: { ...process.env, ...GIT_ENVIRONMENT } });
  assert.equal(run.status, 0, run.stderr.toString());

  const reportPath = join(repository.root, "records", "reports.json");
  const wantedPath = join(repository.root, "records", "wanted.json");
  const reports = JSON.parse(readFileSync(reportPath, "utf8"));
  const wanted = JSON.parse(readFileSync(wantedPath, "utf8"));
  assert.equal(reports.kind, "computer-corpus-knowledge-debt-reports.v1");
  assert.equal(wanted.schema, "computer-corpus-wanted.v1");
  assert.deepEqual(reports.openings.map(({ section, debt }) => ({ section, debt })),
    [{ section: "services/a-section", debt: { brokenLinks: 1 } }]);
  const observed = reports.openings[0];
  assert.equal(observed.opening.move, "report");
  assert.match(observed.opening.law, /no ratchet debt/u);
  assert.match(observed.opening.subject, /^section:/u);
  assert.equal(observed.opening.conditions, undefined,
    "a source observation must not turn into a self-appointed Work request");
  assert.match(observed.reread, /--section services\/a-section --only --assert brokenLinks<=0/u);
  assert.equal(wanted.pages.length, 0);
  assert.equal(wanted.references.length, 0);
  assert.equal(wanted.unlistedPaths, 1,
    "broken-path authorship demand is counted even when fewer than three referrers name it");

  const assay = () => repository.census("--section", "services/a-section", "--only", "--assert", "brokenLinks<=0");
  assert.equal(assay().status, 1, "the actual original census sees the open condition");
  repository.write(A, "# A\n\nSee [b](../b-section/README.md).\n");
  repository.commit("repair");
  assert.equal(assay().status, 0, "the original independent census observes the corrected source");
});
