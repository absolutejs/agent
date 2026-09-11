import { describe, expect, test } from "bun:test";
import {
  agentPostgresMigrations,
  applyAgentPostgresMigrations,
  type AgentPostgresMigrationClient,
} from "../src/migrations";

const memoryClient = (preset: ReadonlyMap<string, string> = new Map()) => {
  const applied = new Map(preset);
  const statements: string[] = [];
  const client: AgentPostgresMigrationClient = {
    query: async <Row>(text: string, values: ReadonlyArray<unknown> = []) => {
      statements.push(text);
      if (text.startsWith("SELECT digest FROM")) {
        const recorded = applied.get(String(values[0]));

        return {
          rows: (recorded === undefined ? [] : [{ digest: recorded }]) as Row[],
        };
      }
      if (text.startsWith("INSERT INTO absolutejs_agent_migrations")) {
        applied.set(String(values[0]), String(values[3]));
      }

      return { rows: [] };
    },
  };

  return { applied, client, statements };
};

describe("agent PostgreSQL migrations", () => {
  test("includes the complete Execution manifest in dependency order", () => {
    const plan = agentPostgresMigrations();
    const ids = plan.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("execution@0.2.0");
    expect(ids).toContain("execution-tenant-inventory@0.3.0");
    expect(ids.indexOf("execution-tenant-inventory@0.3.0")).toBeGreaterThan(
      ids.indexOf("execution@0.2.0"),
    );
    expect(plan.at(-1)?.id).toBe("agent-commerce-purchase-intents@0.23.1");
    for (const migration of plan) {
      expect(migration.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.sql).toMatch(/CREATE|ALTER/);
    }
  });

  test("applies once and skips the exact recorded digest thereafter", async () => {
    const database = memoryClient();
    const first = await applyAgentPostgresMigrations(database.client);
    const second = await applyAgentPostgresMigrations(database.client);
    const ids = agentPostgresMigrations().map(({ id }) => id);

    expect(first.applied).toEqual(ids);
    expect(second).toEqual({ applied: [], skipped: ids });
    expect(database.statements).toContain("COMMIT");
  });

  test("fails closed if published migration SQL changes in place", async () => {
    const [first] = agentPostgresMigrations();
    if (!first) throw new Error("Expected an agent migration");
    const database = memoryClient(new Map([[first.id, "wrong-digest"]]));

    await expect(applyAgentPostgresMigrations(database.client)).rejects.toThrow(
      `${first.id} changed after it was applied`,
    );
    expect(database.statements).toContain("ROLLBACK");
  });
});

describe("module selection", () => {
  test("omitting modules keeps the whole stack — the historical behaviour", () => {
    const all = agentPostgresMigrations();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((m) => m.module)).has("wallet")).toBe(true);
  });

  test("selecting modules excludes everything else", () => {
    const picked = agentPostgresMigrations(["agency", "mcp"]);
    expect(new Set(picked.map((m) => m.module))).toEqual(
      new Set(["agency", "mcp"]),
    );
    expect(picked.length).toBeLessThan(agentPostgresMigrations().length);
  });

  test("a host that skips wallet never creates its schema", async () => {
    const harness = memoryClient();
    await applyAgentPostgresMigrations(harness.client, {
      modules: ["agency", "execution", "mcp"],
    });
    const sql = harness.statements.join("\n");

    // The two objects that put a function and a constraint trigger into a
    // database that never reads them.
    expect(sql).not.toContain("assert_transaction_balanced");
    expect(sql).not.toContain("wallet_entries_balanced");
    expect(
      [...harness.applied.keys()].some((id) => id.startsWith("wallet")),
    ).toBe(false);
  });

  test("narrowing after a full apply leaves the journal intact", async () => {
    const first = memoryClient();
    await applyAgentPostgresMigrations(first.client);
    const walletIds = [...first.applied.keys()].filter((id) =>
      id.startsWith("wallet"),
    );
    expect(walletIds.length).toBeGreaterThan(0);

    const second = memoryClient(first.applied);
    const result = await applyAgentPostgresMigrations(second.client, {
      modules: ["agency"],
    });
    expect(result.applied).toEqual([]);
    for (const id of walletIds) expect(second.applied.has(id)).toBe(true);
  });
});

test("existing MCP journal entries upgrade without changing their published digest", async () => {
  const database = memoryClient(
    new Map([
      [
        "mcp@0.10.1",
        "1e1fc160ab7c5cf2747b963ae5d12198db5175300f6f89160d3d468f3a495280",
      ],
    ]),
  );
  expect(
    await applyAgentPostgresMigrations(database.client, { modules: ["mcp"] }),
  ).toEqual({ applied: ["mcp@0.17.0"], skipped: ["mcp@0.10.1"] });
});
