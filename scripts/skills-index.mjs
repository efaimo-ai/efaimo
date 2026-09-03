#!/usr/bin/env node
// Skills Quality Index: grade a corpus of public Agent Skills with efaimo and
// emit a markdown report plus the same measurement as JSON. Fetch a
// reproducible corpus first with scripts/skills-corpus.mjs (it writes
// <corpus-dir>/manifest.json).
//
// Usage: node scripts/skills-index.mjs <corpus-dir> [out.md]
//          [--json <out.json>] [--ours <skill-dir>]...
//
// The JSON exists because efaimo-ai renders this index and that site derives
// every number it prints from a committed run at build time. A markdown table
// is prose: a page cannot trace a number to it, and a gate cannot re-derive one
// from it. So the same rows go out twice, and the JSON is the source.
//
// --ours grades skills efaimo publishes itself. They are kept in a SEPARATE
// array, never merged into the corpus: the corpus statistic is "every public
// skill in these three repos at these commits", and quietly adding our own
// would make "97% of public skills score an A" a sentence about a population
// that includes the author.
import fs from "node:fs";
import path from "node:path";
import { checkSkillSet, findSkills } from "../dist/index.js";
import { VERSION } from "../dist/version.js";

const argv = process.argv.slice(2);
const valuesOf = (name) =>
  argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")),
);

const corpus = positional[0];
const out = positional[1] ?? "research/skills-index/REPORT.md";
const outJson = valuesOf("--json")[0] ?? out.replace(/\.md$/, ".json");
const ourDirs = valuesOf("--ours");
if (!corpus) {
  console.error("usage: node scripts/skills-index.mjs <corpus-dir> [out.md] [--json <out.json>] [--ours <dir>]...");
  process.exit(2);
}
// A flag given without a path is an error, not a default. `--json` with the
// path forgotten used to fall back to REPORT.json, so the site's measurement
// was never overwritten and every gate downstream still passed: the stale file
// it did not touch was internally consistent with itself. The only thing wrong
// was the operator's belief that they had refreshed the site, and nothing in
// the pipeline could see that. A dropped --ours path narrows what gets graded
// the same silent way.
const dangling = ["--json", "--ours"].find((f) =>
  argv.some((a, i) => a === f && (!argv[i + 1] || argv[i + 1].startsWith("--"))),
);
if (dangling) {
  console.error(`${dangling} needs a path`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(corpus, "manifest.json"), "utf8"));
} catch {
  manifest = undefined;
}

// Discovery comes from the CLI, not from a copy here.
//
// This file used to carry its own walker: unbounded depth, dot directories
// entered, skipping only node_modules and .git. The CLI's stopped at depth 3
// and never entered a dot directory. On 2026-09-03 that produced 38 here and
// 34 there on the same corpus, each reported with confidence, and the gap sat
// unnoticed until a diff of the two was published side by side. Two walkers
// that agree do so by luck; one walker cannot disagree with itself.
//
// If the shared walk ever truncates, say so rather than quietly measuring a
// subset: that is the same failure as writing a report of zero skills, which
// the guard below already exists for.
function skillDirs(root) {
  const set = findSkills(root);
  if (set.truncatedAt?.length) {
    console.error(
      `warning: the walk stopped at its depth bound in ${set.truncatedAt.length} place(s); ` +
        `skills below those are not in this index:\n  ` +
        set.truncatedAt.slice(0, 5).map((d) => path.relative(root, d)).join("\n  "),
    );
  }
  return [...new Set(set.skills.map((s) => path.dirname(s.file)))];
}

async function gradeDir(dir, source) {
  try {
    const res = await checkSkillSet(dir, path.basename(dir));
    const s = res.perSkill[0];
    const w = res.weigh.perSkill[0];
    return {
      name: s.name,
      source,
      grade: s.report.grade,
      counts: s.report.counts,
      ruleIds: s.report.findings.map((f) => f.ruleId),
      meta: w?.metadataTokens ?? 0,
      body: w?.bodyTokens ?? 0,
      bodyLines: w?.bodyLines ?? 0,
      refFiles: w?.refFileCount ?? 0,
      refTokens: w?.refFileTokens ?? 0,
    };
  } catch (e) {
    return { name: path.basename(dir), source, error: String(e.message ?? e) };
  }
}

const dirs = skillDirs(corpus);
// Empty harvest is a failure, never a written file. skillDirs walks with a
// try/continue, so a corpus path that does not exist returns nothing rather
// than throwing, and this used to write a report of 0 skills, a JSON of 0 rows,
// and print "wrote ... 0 skills" as though it had worked. That JSON is what the
// site renders: overwriting a real measurement with an empty one and calling it
// success is the exact shape this repo keeps paying for.
if (!dirs.length) {
  console.error(`no SKILL.md found under ${corpus}; nothing was measured, so nothing is written`);
  process.exit(2);
}

const rows = [];
for (const dir of dirs) {
  rows.push(await gradeDir(dir, path.relative(corpus, dir).split(path.sep)[0]));
}

// Skills efaimo publishes, graded by the same call on the same rules. Kept out
// of `rows` on purpose: see the header note.
const ours = [];
for (const dir of ourDirs) ours.push(await gradeDir(dir, "efaimo"));

const ok = rows.filter((r) => !r.error);
const n = ok.length;
// Same rule one step later: finding the files but grading none of them is also
// a measurement of nothing.
if (!n) {
  console.error(`found ${rows.length} skills under ${corpus} but graded none of them; refusing to write an empty measurement`);
  process.exit(2);
}
const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
for (const r of ok) dist[r.grade.letter]++;
const withErrors = ok.filter((r) => r.counts.error > 0).length;
// True median: mean of the two middles on an even count, not the upper one.
// This was the THIRD copy of this formula. The other two (efaimo-ai's
// src/lib/measure.js and tools/gates.mjs) were both corrected on 2026-08-01,
// and the note there says two copies was the whole story. It was not: this is
// the GENERATOR, the thing that writes the JSON the other two read. Over the
// committed 36-skill corpus the two answers are 1,673 and 1,632, and
// research/skills-index/REPORT.md has been publishing 1,673 next to a site
// rendering 1,632 from the same rows. Independent re-derivation cannot catch a
// shared definition error, and it especially cannot catch the copy upstream of
// the data.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};
const medianBody = median(ok.map((r) => r.body));
const medianMeta = median(ok.map((r) => r.meta));
const ruleFreq = {};
for (const r of ok) for (const id of new Set(r.ruleIds)) ruleFreq[id] = (ruleFreq[id] ?? 0) + 1;
const topRules = Object.entries(ruleFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);
// Only rows that actually scored below perfect: a fixed slice(0, 12) used to
// pad the "lowest-graded" table with an A (100) tie once the corpus had fewer
// than 12 imperfect skills, presenting a perfect score as one of the worst.
const below = ok.filter((r) => r.grade.score < 100);
const worst = [...below].sort((a, b) => a.grade.score - b.grade.score).slice(0, 12);
const pct = (x) => `${Math.round((x / n) * 100)}%`;

const L = [];
L.push("# The Agent Skills Quality Index");
L.push("");
L.push(`Every public Agent Skill in the corpus, graded by [efaimo](https://github.com/efaimo-ai/efaimo) \`check --skill\`. Corpus: ${n} skills.`);
L.push("");
if (manifest?.sources?.length) {
  L.push("## Corpus");
  L.push("");
  L.push("Every `SKILL.md` in these repositories at these exact commits. Reproduce: `node scripts/skills-corpus.mjs <dir> research/skills-index/manifest.json` fetches the identical corpus (the manifest pins the commits below), then `node scripts/skills-index.mjs <dir>` regenerates this report:");
  L.push("");
  L.push("| source | repository | commit |");
  L.push("|---|---|---|");
  for (const s of manifest.sources) {
    L.push(`| ${s.dir} | ${s.repo} | \`${s.commit.slice(0, 12)}\` |`);
  }
  L.push("");
}
L.push("## Headline");
L.push("");
L.push(`- **${pct(dist.A)} score an A**, but **${pct(withErrors)} carry at least one error-level finding**.`);
L.push(`- The **median skill's instructions are ~${medianBody.toLocaleString("en-US")} tokens** (the spec recommends staying under 5,000), loaded whenever the skill triggers.`);
L.push(`- Median always-on metadata: ~${medianMeta} tokens per skill, loaded at session start for every installed skill.`);
L.push("");
L.push("## Grade distribution");
L.push("");
L.push("| grade | count | share |");
L.push("|---|---|---|");
for (const g of ["A", "B", "C", "D", "F"]) L.push(`| ${g} | ${dist[g]} | ${pct(dist[g])} |`);
L.push("");
L.push("## Most common findings");
L.push("");
L.push("| rule | skills affected |");
L.push("|---|---|");
for (const [id, c] of topRules) L.push(`| ${id} | ${c} (${pct(c)}) |`);
L.push("");
L.push("## Lowest-graded skills");
L.push("");
L.push("| skill | source | grade | errors | warnings | info |");
L.push("|---|---|---|---|---|---|");
for (const r of worst) L.push(`| \`${r.name}\` | ${r.source} | ${r.grade.letter} (${r.grade.score}) | ${r.counts.error} | ${r.counts.warn} | ${r.counts.info} |`);
L.push("");
if (below.length <= 12) {
  L.push(`The other ${n - below.length} skills in the corpus all graded A (100) with zero findings.`);
} else {
  L.push(`${below.length - 12} more skills score below A (100); the full corpus below has every row.`);
}
L.push("");
L.push("## Full corpus");
L.push("");
L.push("<details><summary>Every graded skill</summary>");
L.push("");
L.push("| skill | source | grade |");
L.push("|---|---|---|");
for (const r of [...ok].sort((a, b) => a.name.localeCompare(b.name))) {
  L.push(`| \`${r.name}\` | ${r.source} | ${r.grade.letter} (${r.grade.score}) |`);
}
const failedRows = rows.filter((r) => r.error);
for (const r of failedRows) L.push(`| \`${r.name}\` | ${r.source} | (parse failed) |`);
L.push("");
L.push("</details>");
L.push("");
if (ours.length) {
  L.push("## Not in the corpus: skills efaimo publishes");
  L.push("");
  L.push("Graded by the same call on the same rules, and deliberately kept out of every number above. The corpus statistic is about public skills other people wrote; folding the author's own work into it would quietly change what that percentage means.");
  L.push("");
  L.push("| skill | grade | metadata | body | referenced |");
  L.push("|---|---|---|---|---|");
  for (const r of ours) {
    L.push(
      r.error
        ? `| \`${r.name}\` | (parse failed) | | | |`
        : `| \`${r.name}\` | ${r.grade.letter} (${r.grade.score}) | ${r.meta} | ${r.body.toLocaleString("en-US")} | ${r.refFiles} files, ${r.refTokens.toLocaleString("en-US")} |`,
    );
  }
  L.push("");
}
L.push(`<sub>Reproduce a row: \`npx efaimo check --skill <skill-dir>\`. Corpus and method are open; this is a lint-quality signal, not a security audit.</sub>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, L.join("\n") + "\n");

// The JSON carries ROWS, not conclusions. Whatever renders this (the site page,
// and the site's numbers-trace gate) recomputes the distribution and the
// medians from these rows independently, so a page can never bless its own
// arithmetic by reading back a total it also printed.
const json = {
  tool: "efaimo",
  version: VERSION,
  generatedAt: new Date().toISOString().slice(0, 10),
  corpus: manifest ?? null,
  skills: rows,
  ours,
};
fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(json, null, 2) + "\n");

console.log(
  `wrote ${out} and ${outJson}: ${n} skills, ${withErrors} with errors, grades ${JSON.stringify(dist)}` +
    (ours.length ? `, plus ${ours.length} of our own (separate)` : ""),
);
