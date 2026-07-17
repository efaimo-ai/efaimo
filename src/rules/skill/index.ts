import path from "node:path";
import type { Finding, SkillRule } from "../../core/types.js";
import { scanTextForInjection } from "../injection.js";
import { formatTokens } from "../../util/misc.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STANDARD_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

function skillLabel(s: { name?: string; file: string }): string {
  return s.name ?? path.basename(path.dirname(s.file));
}

const s101: SkillRule = {
  id: "S101",
  title: "frontmatter does not match the spec",
  surface: "skill",
  check({ skill }) {
    const findings: Finding[] = [];
    const label = skillLabel(skill);
    const push = (severity: Finding["severity"], message: string, fixHint?: string) =>
      findings.push({ ruleId: "S101", severity, title: "frontmatter does not match the spec", message, target: label, fixHint });

    if (skill.parseError) {
      push("error", `${skill.file}: ${skill.parseError}`, "SKILL.md must start with a --- YAML frontmatter block");
      if (!skill.frontmatterRaw) return findings;
    }
    const name = skill.frontmatter.name;
    if (typeof name !== "string" || !name.trim()) {
      push("error", "required field `name` is missing", "add `name:` matching the skill directory name");
    } else {
      if (!NAME_RE.test(name)) {
        push("error", `name "${name}" is invalid (spec: lowercase a-z, 0-9, hyphens; no leading/trailing/double hyphen)`);
      }
      if (name.length > 64) push("error", `name is ${name.length} chars (spec max 64)`);
      const dirName = path.basename(skill.dir);
      if (name !== dirName) {
        push("error", `name "${name}" must match its directory name "${dirName}" (agentskills.io spec)`, "rename the directory or the skill");
      }
    }
    const desc = skill.frontmatter.description;
    if (typeof desc !== "string" || !desc.trim()) {
      push("error", "required field `description` is missing", "hosts select skills by description; without one the skill never triggers");
    } else if (desc.length > 1024) {
      push("error", `description is ${desc.length} chars (spec max 1024)`);
    }
    const compat = skill.frontmatter.compatibility;
    if (typeof compat === "string" && compat.length > 500) {
      push("warn", `compatibility is ${compat.length} chars (spec max 500)`);
    }
    const allowedTools = skill.frontmatter["allowed-tools"];
    if (allowedTools !== undefined && typeof allowedTools !== "string") {
      push("warn", "`allowed-tools` must be a space-separated string per the spec (found a non-string value)");
    }
    const metadata = skill.frontmatter.metadata;
    if (metadata !== undefined) {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        push("warn", "`metadata` must be a map of string keys to string values");
      } else {
        const nonString = Object.entries(metadata as Record<string, unknown>).filter(([, v]) => typeof v !== "string");
        if (nonString.length) push("info", `metadata values should be strings (${nonString.map(([k]) => k).join(", ")})`);
      }
    }
    const unknown = Object.keys(skill.frontmatter).filter((k) => !STANDARD_FIELDS.has(k));
    for (const k of unknown.slice(0, 4)) {
      push("info", `non-standard frontmatter field \`${k}\` (portable fields: ${[...STANDARD_FIELDS].join(", ")})`);
    }
    return findings;
  },
};

const s102: SkillRule = {
  id: "S102",
  title: "weak trigger description",
  surface: "skill",
  check({ skill }) {
    const desc = skill.description?.trim();
    if (!desc) return []; // S101 already errors
    const findings: Finding[] = [];
    const label = skillLabel(skill);
    if (desc.length < 20) {
      findings.push({
        ruleId: "S102",
        severity: "warn",
        title: "weak trigger description",
        message: `description is only ${desc.length} chars; too thin for hosts to match against tasks`,
        target: label,
        fixHint: "state what the skill does AND when to use it, with concrete trigger words",
      });
    } else if (!/\buse\b|\bwhen\b|\bfor\b|\bhelps?\b/i.test(desc)) {
      findings.push({
        ruleId: "S102",
        severity: "info",
        title: "weak trigger description",
        message: "description never says when to use the skill; hosts select skills by matching descriptions to tasks",
        target: label,
        fixHint: 'add a "use when ..." clause with the words users actually type',
      });
    }
    return findings;
  },
};

const s103: SkillRule = {
  id: "S103",
  title: "trigger collision in skill set",
  surface: "skill",
  check({ skill, set }) {
    // Only emit from the first skill to avoid duplicate pair reports.
    if (set.skills.length < 2 || set.skills[0] !== skill) return [];
    const findings: Finding[] = [];
    const entries = set.skills
      .filter((s) => s.description)
      .map((s) => ({ label: skillLabel(s), tokens: new Set(normalize(s.description!)) }));
    for (let i = 0; i < entries.length && findings.length < 5; i++) {
      for (let j = i + 1; j < entries.length && findings.length < 5; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        const inter = [...a.tokens].filter((t) => b.tokens.has(t)).length;
        const union = new Set([...a.tokens, ...b.tokens]).size;
        if (union > 0 && inter / union > 0.55) {
          findings.push({
            ruleId: "S103",
            severity: "warn",
            title: "trigger collision in skill set",
            message: `skills "${a.label}" and "${b.label}" have ${Math.round((inter / union) * 100)}% overlapping descriptions; hosts may trigger the wrong one`,
            fixHint: "differentiate the descriptions by task and trigger words",
          });
        }
      }
    }
    const names = set.skills.map((s) => s.name).filter(Boolean) as string[];
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    for (const d of [...new Set(dupes)]) {
      findings.push({
        ruleId: "S103",
        severity: "error",
        title: "trigger collision in skill set",
        message: `duplicate skill name "${d}" in the set`,
      });
    }
    return findings;
  },
};

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

const s104: SkillRule = {
  id: "S104",
  title: "context budget",
  surface: "skill",
  check({ skill, weigh }) {
    if (!weigh) return [];
    const entry = weigh.perSkill.find((e) => e.dir === skill.dir);
    if (!entry) return [];
    const label = skillLabel(skill);
    const findings: Finding[] = [];
    // The spec targets ~100 tokens but allows a 1024-char description (~256
    // tokens), so only flag metadata that is genuinely heavy, and as info.
    if (entry.metadataTokens > 260) {
      findings.push({
        ruleId: "S104",
        severity: "info",
        title: "context budget",
        message: `metadata level is ~${formatTokens(entry.metadataTokens)} tokens; the spec targets ~100 and this loads at startup for every installed skill`,
        target: label,
        fixHint: "tighten name + description",
      });
    }
    if (entry.bodyTokens > 5000) {
      findings.push({
        ruleId: "S104",
        severity: "warn",
        title: "context budget",
        message: `instructions are ~${formatTokens(entry.bodyTokens)} tokens (spec recommends staying under 5k)`,
        target: label,
        fixHint: "move detail into references/ files loaded on demand (progressive disclosure)",
      });
    }
    if (entry.bodyLines > 500) {
      findings.push({
        ruleId: "S104",
        severity: "warn",
        title: "context budget",
        message: `SKILL.md is ${entry.bodyLines} lines (spec recommends under 500)`,
        target: label,
      });
    }
    if (entry.bodyTokens > 2500 && entry.refFileCount === 0) {
      findings.push({
        ruleId: "S104",
        severity: "info",
        title: "context budget",
        message: "long instructions with no referenced files; consider progressive disclosure (scripts/, references/, assets/)",
        target: label,
      });
    }
    return findings;
  },
};

const s105: SkillRule = {
  id: "S105",
  title: "possible instruction injection",
  surface: "skill",
  check({ skill }) {
    const label = skillLabel(skill);
    const findings = scanTextForInjection(skill.body, { ruleId: "S105", where: `skill "${label}" body`, cap: 8 });
    if (skill.description) {
      findings.push(
        ...scanTextForInjection(skill.description, {
          ruleId: "S105",
          where: `skill "${label}" description`,
          cap: Math.max(0, 8 - findings.length),
        }),
      );
    }
    return findings;
  },
};

const s106: SkillRule = {
  id: "S106",
  title: "broken or escaping file references",
  surface: "skill",
  check({ skill }) {
    const findings: Finding[] = [];
    const label = skillLabel(skill);
    for (const ref of skill.referencedPaths) {
      if (findings.length >= 10) break;
      if (!ref.exists) {
        // Only a markdown link to a missing file is unambiguously a broken
        // reference. A backticked path is too often an example in prose, so it
        // is not flagged (avoids false positives on well-written skills).
        if (ref.source !== "link") continue;
        findings.push({
          ruleId: "S106",
          severity: "error",
          title: "broken or escaping file references",
          message: `references missing file "${ref.raw}"`,
          target: label,
          fixHint: "agents will fail mid-task when they try to open it",
        });
      } else if (ref.raw.includes("..")) {
        findings.push({
          ruleId: "S106",
          severity: "warn",
          title: "broken or escaping file references",
          message: `reference "${ref.raw}" escapes the skill directory; skills should be self-contained`,
          target: label,
        });
      } else if (ref.raw.split("/").length > 2) {
        findings.push({
          ruleId: "S106",
          severity: "info",
          title: "broken or escaping file references",
          message: `reference "${ref.raw}" is nested ${ref.raw.split("/").length - 1} levels deep (spec suggests one level from the skill root)`,
          target: label,
        });
      }
    }
    return findings;
  },
};

export const SKILL_RULES: SkillRule[] = [s101, s102, s103, s104, s105, s106];
