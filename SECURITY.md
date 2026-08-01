# Security policy

## Reporting a vulnerability

Email **hello@efaimo.ai** with details and, if possible, a
reproduction. Please do not open a public issue for a vulnerability. We aim to
acknowledge within a few days.

## Scope and threat model

efaimo connects to MCP servers you point it at and spawns them as child processes,
or fetches remote server URLs. Treat any server or skill you audit as untrusted
input:

- `efaimo` runs the stdio command you give it. Only weigh/check commands you would
  otherwise run yourself.
- Tool descriptions, skill bodies, and server instructions are untrusted text.
  efaimo reads them to grade them and never executes them.
- efaimo sends no telemetry, and does not send your code or server output
  anywhere. It does make these network calls, and this list was incomplete
  until 2026-08-02:
  - the target you named;
  - for a remote target that answers `401`, the OAuth resource-metadata URL
    given in its `WWW-Authenticate` header, and then the authorization-server
    URL named in that document. Both are hosts you did not type, taken from
    the target's own response, and both go through the same SSRF guard as the
    target itself;
  - `\<origin\>/.well-known/mcp` on a remote target;
  - with `--conformance`, an `npx` fetch of the pinned
    `@modelcontextprotocol/conformance` package from the npm registry;
  - with `--anthropic`, the Anthropic `count_tokens` API using your
    `ANTHROPIC_API_KEY`;
  - with `efaimo test --live`, the model API for the model you selected
    (Anthropic or OpenAI), using your own key.

## Not a security scanner

efaimo's injection checks (rules E130 and S105) are surface heuristics for obvious
patterns, not a substitute for a dedicated MCP/agent security scanner such as Snyk
agent-scan or the Cisco MCP Scanner. A clean efaimo report is not a security
attestation.
