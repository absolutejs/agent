import { defineManifest, toolFactory } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

const tool = toolFactory<never>();

export const manifest = defineManifest<Record<string, never>, never>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "application-developers"],
    intents: [
      "build an agent-first application",
      "audit an agent stack",
      "compose agent infrastructure",
    ],
    keywords: [
      "agents",
      "absolutejs",
      "identity",
      "orchestration",
      "security",
      "interoperability",
    ],
    protocols: ["OAuth 2.0", "MCP", "A2A 1.0", "Arazzo 1.1", "WebMCP"],
  },
  identity: {
    accent: "#111827",
    category: "ai",
    description:
      "The discoverable production agent stack for AbsoluteJS: auth.md identity and delegation, policy-gated actions, durable execution, sandboxing, trust, scoped memory, triggers, MCP, A2A, Arazzo, spend controls, operations, and conformance.",
    docsUrl: "https://github.com/absolutejs/agent",
    name: "@absolutejs/agent",
    tagline: "Build agents that can safely act, persist, pay, and be found.",
  },
  settings: Type.Object({}),
  tools: {
    inspect_agent_stack: tool.workspace({
      annotations: { readOnlyHint: true },
      capabilities: ["read", "glob"],
      description:
        "Inspect an AbsoluteJS project for the production agent stack and report missing safety or discoverability packages.",
      input: Type.Object({}),
      handler: async (_input, workspace) => {
        const packageFiles = (await workspace.glob?.("**/package.json")) ?? [];
        const packageFile = packageFiles.find(
          (file) => !file.includes("node_modules"),
        );
        if (packageFile === undefined) return "No package.json found.";
        const source = (await workspace.read(packageFile)) ?? "";
        if (source.includes('"@absolutejs/agent"')) {
          return "The @absolutejs/agent production stack is installed.";
        }
        const expected = [
          "@absolutejs/auth",
          "@absolutejs/agency",
          "@absolutejs/agent-runtime",
          "@absolutejs/agent-sandbox",
          "@absolutejs/agent-trust",
          "@absolutejs/agent-discovery",
          "@absolutejs/agent-conformance",
        ];
        const missing = expected.filter((name) => !source.includes(name));

        return missing.length === 0
          ? "Core production agent packages are present."
          : `Missing production agent packages: ${missing.join(", ")}`;
      },
    }),
  },
  wiring: [
    {
      description:
        "Import the typed stack composer and add each production capability explicitly.",
      id: "default",
      server: {
        code: "defineAgentStack([])",
        imports: [{ from: "@absolutejs/agent", names: ["defineAgentStack"] }],
        placement: "module-scope",
      },
      title: "Production agent stack",
    },
  ],
});
