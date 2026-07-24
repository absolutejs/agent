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
