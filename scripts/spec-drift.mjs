#!/usr/bin/env node
// Does the spec efaimo audits against still exist as we read it?
//
// This script exists because of a four day gap nobody in this repo could have
// noticed. E101-E118 were written against the Release Candidate locked
// 2026-05-21. The final published 2026-07-28 and moved things that mattered
// (DiscoverResult.serverInfo deleted, DiscoverResult made cacheable, three
// error codes renumbered), and not one file here said so. Every other check we
// own points inward, at our code. This one points at the document our rules
// are a reading of, which is the only dependency we cannot lint.
//
// Two questions, both answered against primary sources:
//   1. Is there a published spec revision NEWER than the one we target?
//   2. Has the revision we target changed under its own tag since we pinned it?
//
// usage: node scripts/spec-drift.mjs            check, exit 1 on drift
//        node scripts/spec-drift.mjs --update   re-pin to what is live now
//
// Never process.exit() here: this script holds open fetch handles, and exiting
// out from under them aborts the process on Windows (libuv asserts in
// async.c). Setting process.exitCode lets node drain and still report.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PIN_FILE = join(HERE, "spec-pin.json");
const REPO = "modelcontextprotocol/modelcontextprotocol";
const UPDATE = process.argv.includes("--update");

let failures = 0;
const fail = (msg) => {
  console.log(`FAIL  ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`PASS  ${msg}`);

async function main() {
  // The version we target is declared once, in the probe client. Reading it
  // here rather than restating it keeps this script from drifting from the
  // thing it is supposed to be watching.
  const probeSrc = readFileSync(join(ROOT, "src/clients/rawprobe.ts"), "utf8");
  const target = probeSrc.match(/RC_VERSION\s*=\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
  if (!target) {
    fail("could not read RC_VERSION from src/clients/rawprobe.ts; this script is watching nothing");
    return;
  }
  console.log(`efaimo targets MCP ${target}\n`);

  const ua = { "User-Agent": "efaimo-spec-drift", Accept: "application/vnd.github+json" };

  // --- 1. a newer published revision ---------------------------------------
  let releases;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: ua });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    releases = await r.json();
  } catch (e) {
    // A checker that cannot reach its source has not passed, it has abstained.
    fail(`could not reach the spec repo (${e.message}); drift is UNKNOWN, not absent`);
    return;
  }

  const dated = releases
    .filter((x) => !x.prerelease && !x.draft && /^\d{4}-\d{2}-\d{2}$/.test(x.tag_name ?? ""))
    .map((x) => x.tag_name)
    .sort();
  if (!dated.length) {
    // Empty harvest is a failure, not a quiet pass: the tag naming may have
    // changed under us, which is itself the drift this script looks for.
    fail("no dated non-prerelease releases parsed; the release naming may have changed, re-aim this script");
  } else {
    const newest = dated[dated.length - 1];
    if (newest > target) {
      fail(
        `MCP ${newest} has published and efaimo still targets ${target}. Re-read the changelog and diff the schema before trusting any E1xx result.`,
      );
    } else {
      pass(`${target} is still the newest published revision (saw ${dated.slice(-3).join(", ")})`);
    }
  }

  // --- 2. the targeted revision, byte for byte -----------------------------
  const schemaUrl = `https://raw.githubusercontent.com/${REPO}/${target}/schema/${target}/schema.ts`;
  let schema;
  try {
    const r = await fetch(schemaUrl);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    schema = await r.text();
  } catch (e) {
    fail(`could not fetch ${schemaUrl} (${e.message}); drift is UNKNOWN`);
    return;
  }

  const sha = createHash("sha256").update(schema).digest("hex");
  if (UPDATE) {
    writeFileSync(PIN_FILE, `${JSON.stringify({ specVersion: target, schemaUrl, sha256: sha }, null, 2)}\n`);
    console.log(`\nre-pinned ${target} at ${sha.slice(0, 16)} -> scripts/spec-pin.json`);
    return;
  }
  if (!existsSync(PIN_FILE)) {
    fail("scripts/spec-pin.json is missing; run with --update to pin the schema we read");
    return;
  }
  const pin = JSON.parse(readFileSync(PIN_FILE, "utf8"));
  if (pin.specVersion !== target) {
    fail(`the pin is for ${pin.specVersion} but the code targets ${target}; run with --update after reconciling them`);
  } else if (pin.sha256 !== sha) {
    fail(
      `${target}/schema.ts changed under its own tag (pinned ${pin.sha256.slice(0, 16)}, live ${sha.slice(0, 16)}). Diff it before re-pinning.`,
    );
  } else {
    pass(`${target}/schema.ts unchanged since it was pinned (${sha.slice(0, 16)})`);
  }
}

await main();
if (!UPDATE) {
  console.log(`\n${failures === 0 ? "no spec drift" : `${failures} FAILING`}`);
}
process.exitCode = failures === 0 ? 0 : 1;
