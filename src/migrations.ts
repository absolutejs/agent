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

/**
 * The subsystems whose schema this runner can apply. A host selects the ones it
 * actually uses; anything it leaves out is never created.
 *
 * Applying the whole stack unconditionally means an app that only wants, say,
 * agency approvals still gets wallet's six tables, its balance-assertion
 * function, and a constraint trigger — inert schema in a production database
 * that nothing reads, that every schema audit has to explain, and that shows up
 * in any drift or catalog check as unaccounted-for objects.
 */
export type AgentPostgresModule =
  | "a2a"
  | "agency"
  | "agent-control"
  | "agent-inbox"
  | "agent-memory"
  | "agent-runtime"
  | "commerce"
  | "execution"
  | "mcp"
  | "wallet";

export type AgentPostgresMigration = {
  digest: string;
  id: string;
  module: AgentPostgresModule;
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
    module: "agency" as const,
    packageName: "@absolutejs/agency",
    packageVersion: migration.id.split("@").at(-1) ?? "unknown",
  })),
  {
    id: "agent-runtime@0.1.0",
    module: "agent-runtime",
    packageName: "@absolutejs/agent-runtime",
    packageVersion: "0.1.0",
    sql: agentRuntimePostgresSchemaSql(),
  },
  {
    id: "agent-memory@0.1.0",
    module: "agent-memory",
    packageName: "@absolutejs/agent-memory",
    packageVersion: "0.1.0",
    sql: agentMemoryPostgresSchemaSql(),
  },
  {
    id: "agent-inbox@0.1.0",
    module: "agent-inbox",
    packageName: "@absolutejs/agent-inbox",
    packageVersion: "0.1.0",
    sql: agentInboxPostgresSchemaSql(),
  },
  {
    id: "mcp@0.10.1",
    module: "mcp",
    packageName: "@absolutejs/mcp",
    packageVersion: "0.10.1",
    sql: mcpPostgresSchemaSql(),
  },
  {
    id: "a2a@0.2.2",
    module: "a2a",
    packageName: "@absolutejs/a2a",
    packageVersion: "0.2.2",
    sql: a2aPostgresSchemaSql(),
  },
  {
    id: "wallet@0.3.0",
    module: "wallet",
    packageName: "@absolutejs/wallet",
    packageVersion: "0.3.0",
    sql: walletPostgresSchemaSql(),
  },
  {
    id: "wallet-agent-tenant-inventory@0.5.0",
    module: "wallet",
    packageName: "@absolutejs/wallet",
    packageVersion: "0.5.0",
    sql: walletAgentTenantInventoryPostgresSchemaSql(),
  },
  {
    id: "agent-control@0.4.0",
    module: "agent-control",
    packageName: "@absolutejs/agent-control",
    packageVersion: "0.4.0",
    sql: agentControlPostgresSchemaSql(),
  },
  ...executionPostgresMigrations().map((migration) => ({
    ...migration,
    module: "execution" as const,
  })),
  {
    id: "agent-commerce-purchase-intents@0.23.1",
    module: "commerce",
    packageName: "@absolutejs/agent",
    packageVersion: "0.23.1",
    sql: agentPurchaseIntentsPostgresSchemaSql(),
  },
] as const;

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Ordered database contract for the AbsoluteJS agent stack.
 *
 * Pass `modules` to get only the subsystems the host actually uses; omit it for
 * the complete stack, which is the historical behaviour. Narrowing later is
 * safe: already-applied migrations stay recorded in the journal and are simply
 * not revisited, and widening again applies the rest on the next run.
 */
export const agentPostgresMigrations = (
  modules?: readonly AgentPostgresModule[],
): AgentPostgresMigration[] => {
  const selected = modules === undefined ? null : new Set(modules);

  return definitions
    .filter((migration) => selected === null || selected.has(migration.module))
    .map((migration) => ({ ...migration, digest: digest(migration.sql) }));
};

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

export type ApplyAgentPostgresMigrationsOptions = {
  /** Subsystems to apply. Omit for the complete stack. Passing only what the
   *  host uses keeps unused schema — wallet's tables, function, and constraint
   *  trigger being the usual culprits — out of its database entirely. */
  modules?: readonly AgentPostgresModule[];
};

/** Apply the selected package-owned agent migrations once under a
 *  cross-replica lock. */
export const applyAgentPostgresMigrations = async (
  client: AgentPostgresMigrationClient,
  options: ApplyAgentPostgresMigrationsOptions = {},
) => {
  const result: AgentPostgresMigrationResult = { applied: [], skipped: [] };
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
    LOCK_KEY,
  ]);
  try {
    await client.query(JOURNAL_SQL);
    for (const migration of agentPostgresMigrations(options.modules)) {
      await migrateOne(client, migration, result);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      LOCK_KEY,
    ]);
  }

  return result;
};
