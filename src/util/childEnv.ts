/**
 * Minimal environment for spawned MCP servers: enough to run node/npx/python
 * on each OS without leaking the caller's full environment (mirrors the
 * conservative default the official SDK uses).
 */
const KEEP = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "WINDIR",
  "HOME",
  "USERPROFILE",
  "USERNAME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMDATA",
  "LANG",
  "LC_ALL",
  "TERM",
  "NODE",
  "NVM_BIN",
];

export function minimalChildEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (KEEP.includes(key.toUpperCase())) {
      const v = process.env[key];
      if (v !== undefined) out[key] = v;
    }
  }
  return out;
}
