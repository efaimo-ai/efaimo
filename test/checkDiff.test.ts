import { describe, it, expect } from "vitest";
import { diffCheck, flattenCheck, CheckDiffRefused, type CheckEnvelope } from "../src/check/diff.js";

function skill(name: string, score: number, letter = "A", tokens = { metadata: 20, body: 100, referenced: 0 }) {
  return {
    name,
    dir: `/skills/${name}`,
    report: {
      tool: "efaimo",
      surface: "skill",
      target: name,
      findings: [],
      counts: { error: 0, warn: 0, info: 0 },
      grade: { score, letter },
    },
    weigh: tokens,
  };
}

function setEnvelope(
  skills: ReturnType<typeof skill>[],
  over: Partial<CheckEnvelope> = {},
): CheckEnvelope {
  return {
    tool: "efaimo",
    version: "0.3.0",
    rulesVersion: "2",
    kind: "check",
    data: {
      label: "corpus",
      root: "/corpus",
      perSkill: skills.map(({ name, dir, report }) => ({ name, dir, report })),
      setFindings: [],
      weigh: {
        kind: "skill",
        label: "corpus",
        perSkill: skills.map((s) => ({
          name: s.name,
          dir: s.dir,
          metadataTokens: s.weigh.metadata,
          bodyTokens: s.weigh.body,
          bodyLines: 10,
          refFileCount: 0,
          refFileTokens: s.weigh.referenced,
        })),
        totals: { metadata: 0, body: 0, refFiles: 0 },
      },
    },
    ...over,
  };
}

describe("flattenCheck", () => {
  it("reads the skill-set shape and joins tokens by name, not by position", () => {
    const env = setEnvelope([skill("b", 90), skill("a", 100)]);
    // Reverse the weigh list so a positional join would attribute the wrong
    // tokens. The two lists are built by different passes and nothing
    // guarantees their orders agree.
    const data = env.data as { weigh: { perSkill: unknown[] } };
    data.weigh.perSkill = [...data.weigh.perSkill].reverse();
    (data.weigh.perSkill[0] as { metadataTokens: number }).metadataTokens = 777;

    const items = flattenCheck(env);
    expect(items.map((i) => i.name)).toEqual(["b", "a"]);
    expect(items.find((i) => i.name === "a")!.metadata).toBe(777);
    expect(items.find((i) => i.name === "b")!.metadata).toBe(20);
  });

  it("reads the single-target shape, where the report is the data", () => {
    const env: CheckEnvelope = {
      tool: "efaimo",
      version: "0.3.0",
      rulesVersion: "2",
      kind: "check",
      data: {
        tool: "efaimo",
        surface: "skill",
        target: "solo",
        findings: [{ ruleId: "S104", severity: "warn", title: "t", message: "m", target: "solo" }],
        counts: { error: 0, warn: 1, info: 0 },
        grade: { score: 95, letter: "A" },
      },
    };
    const items = flattenCheck(env);
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("solo");
    expect(items[0]!.warns).toBe(1);
    expect(items[0]!.ruleIds).toEqual(["S104"]);
    // No weigh block on a single target, so the cost columns must be absent
    // rather than zero: zero would report a real cost of nothing.
    expect(items[0]!.metadata).toBeUndefined();
  });
});

describe("diffCheck controls", () => {
  it("refuses two runs made under different rulesets", () => {
    const before = setEnvelope([skill("a", 100)], { rulesVersion: "1" });
    const after = setEnvelope([skill("a", 80, "B")], { rulesVersion: "2" });
    expect(() => diffCheck(before, after)).toThrow(CheckDiffRefused);
    expect(() => diffCheck(before, after)).toThrow(/different rulesets/);
  });

  it("proceeds under --allow-rules-drift but marks the result unattributable", () => {
    const before = setEnvelope([skill("a", 100)], { rulesVersion: "1" });
    const after = setEnvelope([skill("a", 80, "B")], { rulesVersion: "2" });
    const d = diffCheck(before, after, { allowRulesDrift: true });
    expect(d.rulesDrift).toBe(true);
    expect(d.worsened).toHaveLength(1);
    expect(d.notes.join(" ")).toMatch(/cannot be attributed/);
  });

  it("refuses when nothing pairs, because that is not 'no change'", () => {
    const before = setEnvelope([skill("a", 100)]);
    const after = setEnvelope([skill("z", 100)]);
    expect(() => diffCheck(before, after)).toThrow(/0 in common/);
  });

  it("refuses a file that is not an efaimo report", () => {
    const before = { tool: "something-else", kind: "check" } as CheckEnvelope;
    expect(() => diffCheck(before, setEnvelope([skill("a", 100)]))).toThrow(/not an efaimo report/);
  });

  it("refuses to compare different kinds of report", () => {
    const before = setEnvelope([skill("a", 100)], { kind: "weigh" });
    expect(() => diffCheck(before, setEnvelope([skill("a", 100)]))).toThrow(/different kinds/);
  });
});

describe("diffCheck results", () => {
  it("separates improved, worsened and held, and lists added and removed", () => {
    const before = setEnvelope([skill("up", 80, "B"), skill("down", 100), skill("same", 90), skill("gone", 70, "C")]);
    const after = setEnvelope([skill("up", 95), skill("down", 85, "B"), skill("same", 90), skill("new", 100)]);
    const d = diffCheck(before, after);
    expect(d.paired).toBe(3);
    expect(d.improved.map((m) => m.name)).toEqual(["up"]);
    expect(d.worsened.map((m) => m.name)).toEqual(["down"]);
    expect(d.held).toBe(1);
    expect(d.added).toEqual(["new"]);
    expect(d.removed).toEqual(["gone"]);
  });

  it("keeps the three token costs apart and never reports their sum", () => {
    const before = setEnvelope([skill("a", 100, "A", { metadata: 100, body: 1000, referenced: 10 })]);
    const after = setEnvelope([skill("a", 100, "A", { metadata: 100, body: 1000, referenced: 1010 })]);
    const d = diffCheck(before, after);
    expect(d.costs.map((c) => c.column)).toEqual(["metadata", "body", "referenced"]);
    expect(d.costs.find((c) => c.column === "metadata")!.pct).toBe(0);
    expect(d.costs.find((c) => c.column === "body")!.pct).toBe(0);
    expect(d.costs.find((c) => c.column === "referenced")!.pct).toBeCloseTo(10000, 0);
    // The summed view would be +90 percent and would describe none of them.
    expect(JSON.stringify(d.costs)).not.toContain('"total"');
  });

  it("names a single subject that is most of a column's movement", () => {
    const before = setEnvelope([
      skill("whale", 100, "A", { metadata: 10, body: 10, referenced: 1000 }),
      skill("minnow", 100, "A", { metadata: 10, body: 10, referenced: 100 }),
    ]);
    const after = setEnvelope([
      skill("whale", 100, "A", { metadata: 10, body: 10, referenced: 9000 }),
      skill("minnow", 100, "A", { metadata: 10, body: 10, referenced: 110 }),
    ]);
    const d = diffCheck(before, after);
    const ref = d.costs.find((c) => c.column === "referenced")!;
    expect(ref.dominatedBy?.name).toBe("whale");
    expect(ref.dominatedBy!.shareOfMovement).toBeGreaterThan(99);
  });

  it("leaves dominatedBy unset when movement is spread out", () => {
    const before = setEnvelope([
      skill("a", 100, "A", { metadata: 10, body: 100, referenced: 0 }),
      skill("b", 100, "A", { metadata: 10, body: 100, referenced: 0 }),
    ]);
    const after = setEnvelope([
      skill("a", 100, "A", { metadata: 10, body: 150, referenced: 0 }),
      skill("b", 100, "A", { metadata: 10, body: 150, referenced: 0 }),
    ]);
    const d = diffCheck(before, after);
    expect(d.costs.find((c) => c.column === "body")!.dominatedBy).toBeUndefined();
  });

  it("omits cost columns entirely when a side has no weigh block", () => {
    const solo: CheckEnvelope = {
      tool: "efaimo",
      version: "0.3.0",
      rulesVersion: "2",
      kind: "check",
      data: {
        tool: "efaimo",
        surface: "skill",
        target: "solo",
        findings: [],
        counts: { error: 0, warn: 0, info: 0 },
        grade: { score: 100, letter: "A" },
      },
    };
    const d = diffCheck(solo, solo);
    expect(d.costs).toEqual([]);
    expect(d.paired).toBe(1);
  });
});
