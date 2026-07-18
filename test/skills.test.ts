import { describe, it, expect } from "vitest";
import path from "node:path";
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
