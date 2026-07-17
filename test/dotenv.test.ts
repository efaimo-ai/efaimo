import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/util/dotenv.js";

function withEnvFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "efaimo-env-"));
  writeFileSync(join(dir, ".env"), body, "utf8");
  return dir;
}

const touched: string[] = [];
afterEach(() => {
  for (const k of touched.splice(0)) delete process.env[k];
});

describe("loadDotEnv", () => {
  it("returns [] and does nothing when no .env exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "efaimo-env-"));
    expect(loadDotEnv(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads KEY=VALUE lines, skipping comments and blanks", () => {
    touched.push("EFAIMO_T_A", "EFAIMO_T_B");
    const dir = withEnvFile("# a comment\n\nEFAIMO_T_A=hello\nEFAIMO_T_B = world \n");
    const loaded = loadDotEnv(dir);
    expect(loaded).toEqual(["EFAIMO_T_A", "EFAIMO_T_B"]);
    expect(process.env.EFAIMO_T_A).toBe("hello");
    expect(process.env.EFAIMO_T_B).toBe("world");
  });

  it("never overrides a variable already set in the environment", () => {
    touched.push("EFAIMO_T_KEEP");
    process.env.EFAIMO_T_KEEP = "from-shell";
    const dir = withEnvFile("EFAIMO_T_KEEP=from-file");
    expect(loadDotEnv(dir)).toEqual([]);
    expect(process.env.EFAIMO_T_KEEP).toBe("from-shell");
  });

  it("strips matching surrounding quotes but keeps inner characters", () => {
    touched.push("EFAIMO_T_Q", "EFAIMO_T_S", "EFAIMO_T_EQ");
    const dir = withEnvFile(`EFAIMO_T_Q="a=b#c"\nEFAIMO_T_S='x y'\nEFAIMO_T_EQ=k=v=w`);
    loadDotEnv(dir);
    expect(process.env.EFAIMO_T_Q).toBe("a=b#c");
    expect(process.env.EFAIMO_T_S).toBe("x y");
    expect(process.env.EFAIMO_T_EQ).toBe("k=v=w");
  });

  it("ignores malformed keys and keyless lines", () => {
    touched.push("EFAIMO_T_OK");
    const dir = withEnvFile("=nokey\n123BAD=1\nno-dash=1\nEFAIMO_T_OK=1");
    expect(loadDotEnv(dir)).toEqual(["EFAIMO_T_OK"]);
  });

  it("supports an `export ` prefix", () => {
    touched.push("EFAIMO_T_EXP");
    const dir = withEnvFile("export EFAIMO_T_EXP=exported");
    expect(loadDotEnv(dir)).toEqual(["EFAIMO_T_EXP"]);
    expect(process.env.EFAIMO_T_EXP).toBe("exported");
  });

  it("strips a whitespace-preceded inline comment, but not a mid-token # or one inside quotes", () => {
    touched.push("EFAIMO_T_C1", "EFAIMO_T_C2", "EFAIMO_T_C3");
    const dir = withEnvFile(`EFAIMO_T_C1=val # trailing note\nEFAIMO_T_C2=a#b\nEFAIMO_T_C3="x # y"`);
    loadDotEnv(dir);
    expect(process.env.EFAIMO_T_C1).toBe("val");
    expect(process.env.EFAIMO_T_C2).toBe("a#b");
    expect(process.env.EFAIMO_T_C3).toBe("x # y");
  });
});
