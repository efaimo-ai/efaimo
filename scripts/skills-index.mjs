#!/usr/bin/env node
// Skills Quality Index: grade a corpus of public Agent Skills with efaimo and
// emit a markdown report. Usage: node scripts/skills-index.mjs <corpus-dir> [out.md]
import fs from "node:fs";
import path from "node:path";
import { checkSkillSet } from "../dist/index.js";

const corpus = process.argv[2];
const out = process.argv[3] ?? "research/skills-index/REPORT.md";
if (!corpus) {
  console.error("usage: node scripts/skills-index.mjs <corpus-dir> [out.md]");
  process.exit(2);
}

function skillDirs(root) {
  const found = new Set();
  const stack = [root];
  const skip = new Set(["node_modules", ".git"]);
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !skip.has(e.name)) stack.push(path.join(dir, e.name));
      else if (e.isFile() && e.name === "SKILL.md") found.add(dir);
    }
  }
  return [...found];
}

const dirs = skillDirs(corpus);
const rows = [];
for (const dir of dirs) {
  try {
    const res = await checkSkillSet(dir, path.basename(dir));
    const s = res.perSkill[0];
    const w = res.weigh.perSkill[0];
    rows.push({
      name: s.name,
      source: path.relative(corpus, dir).split(path.sep)[0],
      grade: s.report.grade,
      counts: s.report.counts,
      ruleIds: s.report.findings.map((f) => f.ruleId),
      meta: w?.metadataTokens ?? 0,
      body: w?.bodyTokens ?? 0,
    });
  } catch (e) {
    rows.push({ name: path.basename(dir), source: "?", error: String(e.message ?? e) });
  }
}

const ok = rows.filter((r) => !r.error);
const n = ok.length;
const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
for (const r of ok) dist[r.grade.letter]++;
const withErrors = ok.filter((r) => r.counts.error > 0).length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const medianBody = median(ok.map((r) => r.body));
const medianMeta = median(ok.map((r) => r.meta));
const ruleFreq = {};
for (const r of ok) for (const id of new Set(r.ruleIds)) ruleFreq[id] = (ruleFreq[id] ?? 0) + 1;
const topRules = Object.entries(ruleFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);
const worst = [...ok].sort((a, b) => a.grade.score - b.grade.score).slice(0, 12);
const pct = (x) => `${Math.round((x / n) * 100)}%`;

const L = [];
L.push("# The Agent Skills Quality Index");
L.push("");
L.push(`Every public Agent Skill in the corpus, graded by [efaimo](https://github.com/efaimo-ai/efaimo) \`check --skill\`. Corpus: ${n} skills.`);
L.push("");
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
L.push(`<sub>Reproduce: \`npx efaimo check --skill <skill>\`. Corpus and method are open; this is a lint-quality signal, not a security audit.</sub>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, L.join("\n") + "\n");
console.log(`wrote ${out}: ${n} skills, ${withErrors} with errors, grades ${JSON.stringify(dist)}`);
