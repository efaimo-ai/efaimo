import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { findSkills, parseSkillFile } from "../src/skills/parse.js";
import { checkSkillSet } from "../src/check/check.js";
import { weighSkills } from "../src/weigh/weigh.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.join(here, "fixtures", "skills");

function ruleIds(findings: { ruleId: string }[]): Set<string> {
  return new Set(findings.map((f) => f.ruleId));
}

describe("skill parsing", () => {
  it("finds all fixture skills", () => {
    const set = findSkills(SKILLS);
    const names = set.skills.map((s) => s.name ?? path.basename(s.dir)).sort();
    expect(names).toContain("good-skill");
    expect(names).toContain("heavy-skill");
    expect(set.skills.length).toBe(3);
  });

  it("parses frontmatter and body of a good skill", () => {
    const set = findSkills(path.join(SKILLS, "good-skill"));
    const s = set.skills[0]!;
    expect(s.name).toBe("good-skill");
    expect(s.description).toMatch(/CSV/);
    expect(s.parseError).toBeUndefined();
    expect(s.referencedPaths.some((r) => r.raw === "reference.md" && r.exists)).toBe(true);
  });

  it("flags a bad skill's frontmatter, injection, and broken ref", async () => {
    const res = await checkSkillSet(path.join(SKILLS, "bad-skill"), "bad");
    const report = res.perSkill[0]!.report;
    const ids = ruleIds(report.findings);
    expect(ids.has("S101")).toBe(true); // name != dir, metadata not a map
    expect(ids.has("S105")).toBe(true); // injection (now info)
    expect(ids.has("S106")).toBe(true); // missing markdown-link ref (error)
    expect(report.counts.error).toBeGreaterThan(0);
    // C, not D/F: the grade reflects the real defects (broken ref, bad
    // frontmatter) and NOT the S105 injection hits, which are shallow
    // heuristics that src/rules/injection.ts says must never move a grade.
    // They used to, silently, which is what dragged this fixture two letters
    // below what its actual errors earn.
    expect(["C", "D", "F"]).toContain(report.grade.letter);
    const injection = report.findings.filter((f) => f.ruleId === "S105");
    expect(injection.length).toBeGreaterThan(0);
    expect(injection.every((f) => f.graded === false)).toBe(true);
  });

  it("gives the good skill a clean bill of health", async () => {
    const res = await checkSkillSet(path.join(SKILLS, "good-skill"), "good");
    const report = res.perSkill[0]!.report;
    expect(report.counts.error).toBe(0);
    expect(["A", "B"]).toContain(report.grade.letter);
  });

  it("flags an oversized body via the context-budget rule", async () => {
    const res = await checkSkillSet(path.join(SKILLS, "heavy-skill"), "heavy");
    const s104 = res.perSkill[0]!.report.findings.filter((f) => f.ruleId === "S104");
    expect(s104.length).toBeGreaterThan(0);
    expect(s104.some((f) => /5k|5000|token/i.test(f.message))).toBe(true);
  });

  it("grades each skill in a set individually (no aggregate F)", async () => {
    const res = await checkSkillSet(SKILLS, "fixtures");
    expect(res.perSkill.length).toBe(3);
    const good = res.perSkill.find((s) => s.name === "good-skill")!;
    const bad = res.perSkill.find((s) => s.name === "totally-different-name" || s.dir.endsWith("bad-skill"))!;
    expect(["A", "B"]).toContain(good.report.grade.letter);
    // Still clearly worse than the good skill, and still scored only on its
    // real errors; see the injection note in the bad-skill test above.
    expect(["C", "D", "F"]).toContain(bad.report.grade.letter);
    expect(bad.report.grade.score).toBeLessThan(good.report.grade.score);
  });

  it("detects a cross-tool-steering instruction (regression: adjective between verb and 'tools')", () => {
    const s = parseSkillFile(path.join(SKILLS, "bad-skill", "SKILL.md"));
    expect(s.body).toMatch(/before using any other tools/i);
  });

  it("treats archive-style dir naming (name-0.1.0) as info, genuine mismatch as warn, never error", async () => {
    const NAMING = path.join(here, "fixtures", "skills-naming");
    const res = await checkSkillSet(NAMING, "naming");
    const tarball = res.perSkill.find((s) => s.dir.endsWith("demo-0.1.0"))!;
    const renamed = res.perSkill.find((s) => s.dir.endsWith("renamed-dir"))!;
    const tarballMismatch = tarball.report.findings.filter(
      (f) => f.ruleId === "S101" && /directory name/.test(f.message),
    );
    const renamedMismatch = renamed.report.findings.filter(
      (f) => f.ruleId === "S101" && /directory name/.test(f.message),
    );
    expect(tarballMismatch.map((f) => f.severity)).toEqual(["info"]);
    expect(renamedMismatch.map((f) => f.severity)).toEqual(["warn"]);
    expect(tarball.report.counts.error).toBe(0);
    expect(renamed.report.counts.error).toBe(0);
    expect(tarball.report.grade.letter).toBe("A");
  });

  it("weighs skills with the three-level split", async () => {
    const set = findSkills(SKILLS);
    const w = await weighSkills(set);
    expect(w.totals.metadata).toBeGreaterThan(0);
    expect(w.totals.body).toBeGreaterThan(0);
    const heavy = w.perSkill.find((s) => s.name === "heavy-skill");
    expect(heavy!.bodyTokens).toBeGreaterThan(5000);
  });
});

describe("S102 after 2026-09-03", () => {
  // Until this date the rule read `desc.length < 20`, then asked only whether
  // one of four trigger words appeared anywhere in the description. So
  // "Useful for various tasks." scored a clean 100 in silence, because "for"
  // sits inside "for various tasks": it tested for the presence of a trigger
  // WORD rather than for the presence of a trigger. Both floors are grounded
  // on the 38 public skills in research/skills-index/manifest.json, whose
  // shortest description is 68 characters and whose thinnest carries 4
  // distinct content terms.
  async function s102(description: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-s102-"));
    const dir = path.join(root, "probe");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---
name: probe
description: ${description}
---

# probe

A body long enough to be ordinary.
`,
    );
    try {
      const res = await checkSkillSet(root, "probe");
      return res.perSkill[0]!.report.findings.filter((f) => f.ruleId === "S102");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it("flags the filler that used to score 100", async () => {
    const f = await s102("Useful for various tasks.");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/only 25 chars/);
  });

  it("flags a description that clears the length floor but says nothing", async () => {
    const f = await s102("Use this for the thing when you use it for the thing you use.");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toMatch(/1 distinct content term once/);
  });

  it("stays silent on a real description", async () => {
    expect(
      await s102(
        "Use before trusting any check that came back clean, such as a grep with no matches or a green CI gate, whenever you are about to report no issues found.",
      ),
    ).toEqual([]);
  });
});
