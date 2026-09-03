import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { findSkills, parseSkillFile, SKILL_WALK_MAX_DEPTH } from "../src/skills/parse.js";
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

describe("skill discovery after 2026-09-03", () => {
  // Two layouts this walk could not see. The first is where a project keeps
  // its own skills, so being blind to it made `check --skill` useless for the
  // most common real case; the second is one directory deeper than the old
  // bound of 3. Together they were the difference between 34 skills and 38 on
  // the public corpus, with scripts/skills-index.mjs reporting the larger
  // number and this reporting the smaller, each with confidence.
  function tree(layout: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-walk-"));
    for (const [rel, name] of Object.entries(layout)) {
      const dir = path.join(root, ...rel.split("/"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Use when probing the walker, for a test that names concrete things.\n---\n\n# ${name}\n\nBody.\n`,
      );
    }
    return root;
  }

  it("finds a skill inside a dot directory", () => {
    const root = tree({ ".claude/skills/probe": "probe" });
    try {
      expect(findSkills(root).skills.map((s) => s.name)).toEqual(["probe"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds a skill one level deeper than the old bound of three", () => {
    const root = tree({ "repo/skills/custom_skills/deep": "deep" });
    try {
      expect(findSkills(root).skills.map((s) => s.name)).toEqual(["deep"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("still refuses .git, so entering dot directories did not open everything", () => {
    const root = tree({ ".git/skills/nope": "nope", "skills/yes": "yes" });
    try {
      expect(findSkills(root).skills.map((s) => s.name)).toEqual(["yes"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("says what it did not look at when the depth bound bites", () => {
    // Deeper than SKILL_WALK_MAX_DEPTH. A bound that truncates in silence is
    // the same failure as a check that examines nothing.
    const deep = Array.from({ length: SKILL_WALK_MAX_DEPTH + 2 }, (_, i) => `d${i}`).join("/");
    const root = tree({ [deep]: "buried" });
    try {
      const set = findSkills(root);
      expect(set.skills).toHaveLength(0);
      expect(set.truncatedAt?.length ?? 0).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports nothing about truncation when the bound never bites", () => {
    const root = tree({ "skills/shallow": "shallow" });
    try {
      expect(findSkills(root).truncatedAt).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("S107: a filename one capitalisation away from a skill", () => {
  // Found while tracing a wrong analysis rather than a bug report. A Windows
  // glob for SKILL.md matched five files actually named skill.md, because the
  // filesystem is case-insensitive; the tools were right to ignore them and
  // the analysis was wrong. The real defect was underneath: nothing anywhere
  // mentioned those files, so a repository could carry a skill that loads on
  // macOS and Windows and does not exist in Linux CI, in silence.
  function tree(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-case-"));
    for (const [rel, filename] of Object.entries(files)) {
      const dir = path.join(root, ...rel.split("/"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, filename),
        "---\nname: probe\ndescription: Use when probing filename casing, naming concrete things a reader would type.\n---\n\n# probe\n\nBody.\n",
      );
    }
    return root;
  }

  it("reports a lowercase skill.md that no rule could otherwise see", async () => {
    const root = tree({ "skills/real": "SKILL.md", "skills/nearly": "skill.md" });
    try {
      const res = await checkSkillSet(root, "probe");
      expect(res.perSkill).toHaveLength(1);
      const s107 = res.setFindings.filter((f) => f.ruleId === "S107");
      expect(s107).toHaveLength(1);
      expect(s107[0]!.severity).toBe("warn");
      expect(s107[0]!.message).toMatch(/Linux CI/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not move any grade, because the subject is not a skill", async () => {
    const clean = tree({ "skills/real": "SKILL.md" });
    const withNearMiss = tree({ "skills/real": "SKILL.md", "skills/nearly": "skill.md" });
    try {
      const a = await checkSkillSet(clean, "a");
      const b = await checkSkillSet(withNearMiss, "b");
      expect(b.perSkill[0]!.report.grade).toEqual(a.perSkill[0]!.report.grade);
    } finally {
      fs.rmSync(clean, { recursive: true, force: true });
      fs.rmSync(withNearMiss, { recursive: true, force: true });
    }
  });

  it("says nothing when every filename is exact", async () => {
    const root = tree({ "skills/real": "SKILL.md" });
    try {
      const res = await checkSkillSet(root, "probe");
      expect(res.setFindings.filter((f) => f.ruleId === "S107")).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
