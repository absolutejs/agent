import { createHash } from "node:crypto";
import { a2aPostgresSchemaSql } from "@absolutejs/a2a";
import { agencyPostgresMigrations } from "@absolutejs/agency";
import { agentControlPostgresSchemaSql } from "@absolutejs/agent-control";
import { agentInboxPostgresSchemaSql } from "@absolutejs/agent-inbox";
import { agentMemoryPostgresSchemaSql } from "@absolutejs/agent-memory";
import { agentRuntimePostgresSchemaSql } from "@absolutejs/agent-runtime";
import { executionPostgresMigrations } from "@absolutejs/execution";
import { mcpPostgresSchemaSql } from "@absolutejs/mcp";
import {
  walletAgentTenantInventoryPostgresSchemaSql,
  walletPostgresSchemaSql,
} from "@absolutejs/wallet";
import { agentPurchaseIntentsPostgresSchemaSql } from "./commerce";

export type AgentPostgresMigration = {
  digest: string;
  id: string;
  packageName: string;
  packageVersion: string;
  sql: string;
};

export type AgentPostgresMigrationClient = {
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: ReadonlyArray<Row> }>;
};

export type AgentPostgresMigrationResult = {
  applied: string[];
  skipped: string[];
};

const LOCK_KEY = "absolutejs:agent:migrations";
const JOURNAL_TABLE = "absolutejs_agent_migrations";
const JOURNAL_SQL = `CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (
  id text PRIMARY KEY,
  package_name text NOT NULL,
  package_version text NOT NULL,
  digest text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

const definitions = [
  ...agencyPostgresMigrations().map((migration) => ({
    ...migration,
    packageName: "@absolutejs/agency",
    packageVersion: migration.id.split("@").at(-1) ?? "unknown",
  })),
  {
    id: "agent-runtime@0.1.0",
    packageName: "@absolutejs/agent-runtime",
    packageVersion: "0.1.0",
    sql: agentRuntimePostgresSchemaSql(),
  },
  {
    id: "agent-memory@0.1.0",
    packageName: "@absolutejs/agent-memory",
    packageVersion: "0.1.0",
    sql: agentMemoryPostgresSchemaSql(),
  },
  {
    id: "agent-inbox@0.1.0",
    packageName: "@absolutejs/agent-inbox",
    packageVersion: "0.1.0",
    sql: agentInboxPostgresSchemaSql(),
  },
  {
    id: "mcp@0.10.1",
    packageName: "@absolutejs/mcp",
    packageVersion: "0.10.1",
    sql: mcpPostgresSchemaSql(),
  },
  {
    id: "a2a@0.2.2",
    packageName: "@absolutejs/a2a",
    packageVersion: "0.2.2",
    sql: a2aPostgresSchemaSql(),
  },
  {
    id: "wallet@0.3.0",
    packageName: "@absolutejs/wallet",
    packageVersion: "0.3.0",
    sql: walletPostgresSchemaSql(),
  },
  {
    id: "wallet-agent-tenant-inventory@0.5.0",
    packageName: "@absolutejs/wallet",
    packageVersion: "0.5.0",
    sql: walletAgentTenantInventoryPostgresSchemaSql(),
  },
  {
    id: "agent-control@0.4.0",
    packageName: "@absolutejs/agent-control",
    packageVersion: "0.4.0",
    sql: agentControlPostgresSchemaSql(),
  },
  ...executionPostgresMigrations(),
  {
    id: "agent-commerce-purchase-intents@0.23.1",
    packageName: "@absolutejs/agent",
    packageVersion: "0.23.1",
    sql: agentPurchaseIntentsPostgresSchemaSql(),
  },
] as const;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Complete ordered database contract for the production AbsoluteJS agent stack. */
export const agentPostgresMigrations = (): AgentPostgresMigration[] =>
  definitions.map((migration) => ({
    ...migration,
    digest: digest(migration.sql),
  }));

const rollback = async (client: AgentPostgresMigrationClient) => {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the migration failure when the connection itself was lost.
  }
};

const migrationDisposition = async (
  client: AgentPostgresMigrationClient,
  migration: AgentPostgresMigration,
) => {
  const existing = await client.query<{ digest: string }>(
    `SELECT digest FROM ${JOURNAL_TABLE} WHERE id = $1 FOR UPDATE`,
    [migration.id],
  );
  const [recorded] = existing.rows;
  if (!recorded) return "applied" as const;
  if (recorded.digest !== migration.digest) {
    throw new Error(
      `Agent migration ${migration.id} changed after it was applied`,
    );
  }

  return "skipped" as const;
};

const recordMigration = async (
  client: AgentPostgresMigrationClient,
  migration: AgentPostgresMigration,
) => {
  await client.query(migration.sql);
  await client.query(
    `INSERT INTO ${JOURNAL_TABLE}
      (id, package_name, package_version, digest)
     VALUES ($1, $2, $3, $4)`,
    [
      migration.id,
      migration.packageName,
      migration.packageVersion,
      migration.digest,
    ],
  );
};

const migrateOne = async (
  client: AgentPostgresMigrationClient,
  migration: AgentPostgresMigration,
  result: AgentPostgresMigrationResult,
) => {
  await client.query("BEGIN");
  try {
    const disposition = await migrationDisposition(client, migration);
    if (disposition === "applied") await recordMigration(client, migration);
    result[disposition].push(migration.id);
    await client.query("COMMIT");
  } catch (error) {
    await rollback(client);
    throw error;
  }
};

/** Apply every package-owned agent migration once under a cross-replica lock. */
export const applyAgentPostgresMigrations = async (
  client: AgentPostgresMigrationClient,
) => {
  const result: AgentPostgresMigrationResult = { applied: [], skipped: [] };
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
    LOCK_KEY,
  ]);
  try {
    await client.query(JOURNAL_SQL);
    for (const migration of agentPostgresMigrations()) {
      await migrateOne(client, migration, result);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      LOCK_KEY,
    ]);
  }

  return result;
};
