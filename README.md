# @absolutejs/agent

The production-grade, provider-neutral agent stack for AbsoluteJS.

This is the cohesive entry point, not another agent runtime. Each engine remains
independently installable and replaceable; this package provides one documented
golden path, typed subpath exports, production-readiness checks, and an
AbsoluteJS manifest that lets coding agents discover the whole stack.

```ts
import { assertProductionReady, defineAgentStack } from "@absolutejs/agent";
import { createAgentRuntime } from "@absolutejs/agent/runtime";
import { createAgency } from "@absolutejs/agent/actions";

const stack = defineAgentStack([
  { capability: "durability", instance: runtime, name: "runtime" },
  { capability: "authorization", instance: agency, name: "actions" },
] as const);

await assertProductionReady(stack); // fails until every production concern is wired
```

## Stable subpaths

- `@absolutejs/agent/auth` — native auth.md registration, ID-JAG, scoped delegation
- `@absolutejs/agent/actions` — approvals, leases, receipts, kill switches, handoffs
- `@absolutejs/agent/runtime` — durable runs, checkpoints, budgets, effects
- `@absolutejs/agent/sandbox` — deny-by-default HTTP, filesystem, and process grants
- `@absolutejs/agent/trust` — provenance, taint propagation, safe context and sinks
- `@absolutejs/agent/memory` — scoped, authorized, erasable durable memory
- `@absolutejs/agent/inbox` — verified webhooks, schedules, retries, dead letters
- `@absolutejs/agent/discovery` — signed well-known documents, cards, text, sitemaps, registry
- `@absolutejs/agent/execution` — transactional outbox, retries, reconciliation, compensation
- `@absolutejs/agent/mcp`, `/a2a`, `/arazzo`, and `/webmcp` — open interoperability, workflow, and browser transports
- `@absolutejs/agent/policy` — versioned policy and AuthZEN adapters
- `@absolutejs/agent/wallet` — reservations, idempotent settlement, spending policy
- `@absolutejs/agent/control` — operator inventory, revoke, restore, kill switches
- `@absolutejs/agent/conformance` — adversarial protocol and action suites

The package deliberately does not introduce an Absolute-only wire protocol.
Applications expose standard MCP, A2A, OAuth, RFC 9728/RFC 8414, auth.md, and
AuthZEN surfaces while Absolute supplies provider-neutral implementation seams.

`/auth.md` is the open auth.md registration profile's conventional discovery
route. Absolute Auth generates it from the application's authoritative OAuth
metadata and implements the flow natively; it is not a WorkOS adapter and does
not require a WorkOS service.

## One authenticated delegation

`createAuthAgencyDelegationAuthority()` bridges the delegation already verified
by Absolute Auth directly into Agency. Put an
`authAgencyAuthorizationDetail()` in the Auth grant to bind its audience,
canonical actions, effects, resource types, and optional resource IDs. Agency
then re-reads that same grant before an action request, lease, and execution;
there is no second grant ID or shadow state to synchronize.
