#!/usr/bin/env node
// Fetch the Skills Quality Index corpus: shallow-clone the source repos and
// record the exact commits in <corpus-dir>/manifest.json. Pass a previously
// published manifest as the second argument to check out those exact commits
// instead of the current HEAD, which reproduces the published index:
//   node scripts/skills-corpus.mjs .corpus research/skills-index/manifest.json
//   node scripts/skills-index.mjs .corpus
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SOURCES = [
  { dir: "anthropics-skills", repo: "https://github.com/anthropics/skills" },
  { dir: "anthropics-claude-cookbooks", repo: "https://github.com/anthropics/claude-cookbooks" },
  { dir: "obra-superpowers", repo: "https://github.com/obra/superpowers" },
];

const corpus = process.argv[2];
const pinFile = process.argv[3];
if (!corpus) {
  console.error("usage: node scripts/skills-corpus.mjs <corpus-dir> [pinned-manifest.json]");
  process.exit(2);
}
const pins = pinFile ? JSON.parse(fs.readFileSync(pinFile, "utf8")) : undefined;
fs.mkdirSync(corpus, { recursive: true });

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const manifest = { fetchedAt: new Date().toISOString(), sources: [] };
for (const s of SOURCES) {
  const dest = path.join(corpus, s.dir);
  if (!fs.existsSync(dest)) {
    console.error(`cloning ${s.repo} ...`);
    // core.longpaths: some corpus repos have paths deep enough to break
    // Windows' 260-char default limit during checkout. `clone -c` persists it
    // into the new clone's config, so later checkouts inherit it.
    execFileSync("git", ["clone", "-c", "core.longpaths=true", "--depth", "1", s.repo, dest], { stdio: "inherit" });
  }
  const pin = pins?.sources?.find((p) => p.dir === s.dir)?.commit;
  if (pin && git(["-C", dest, "rev-parse", "HEAD"]) !== pin) {
    console.error(`pinning ${s.dir} to ${pin.slice(0, 12)} ...`);
    execFileSync("git", ["-C", dest, "fetch", "--depth", "1", "origin", pin], { stdio: "inherit" });
    execFileSync("git", ["-C", dest, "checkout", "--force", pin], { stdio: "inherit" });
  }
  manifest.sources.push({ dir: s.dir, repo: s.repo, commit: git(["-C", dest, "rev-parse", "HEAD"]) });
}
fs.writeFileSync(path.join(corpus, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `corpus ready: ${corpus} (${manifest.sources.map((s) => `${s.dir}@${s.commit.slice(0, 7)}`).join(", ")})`,
);
