import { VERSION } from "../version.js";

export function toJsonEnvelope(kind: "check" | "weigh" | "test", data: unknown): string {
  return JSON.stringify(
    {
      tool: "efaimo",
      version: VERSION,
      kind,
      generatedAt: new Date().toISOString(),
      data,
    },
    null,
    2,
  );
}
