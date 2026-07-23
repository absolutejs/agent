import {
  effectAdapterExecutionInputDigest,
  type EffectAdapterCredentialInstallation,
  type EffectAdapterExecutionEnvelope,
  type EffectAdapterInstallationRegistry,
  type EffectRecord,
  type EffectStore,
  type ExecutionSqlClient,
} from "@absolutejs/execution";
import type {
  AgentSpendRequest,
  SpendRequestResult,
  SpendMandate,
} from "@absolutejs/wallet";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  pgSchema,
  text,
  uniqueIndex,
  type PgAsyncDatabase,
} from "drizzle-orm/pg-core";

export type AgentPurchaseIntentStatus =
  | "drafted"
  | "pending_approval"
  | "mandate_ready"
  | "installation_ready"
  | "enqueued"
  | "cancelled";

export type AgentPurchaseIntentInput<Payload = unknown> = {
  actionId: string;
  adapterId: string;
  agentId: string;
  allowanceId: string;
  amountMinor: number;
  category?: string;
  credentials?: ReadonlyArray<EffectAdapterCredentialInstallation>;
  currency: string;
  destination?: string;
  effect: string;
  expiresAt: string;
  handler: string;
  idempotencyKey: string;
  installationId: string;
  merchantId: string;
  ownerId: string;
  payload: Payload;
  purchaseId: string;
  refundable?: boolean;
  tenantId: string;
};

export type AgentPurchaseIntent<Payload = unknown> = {
  createdAt: number;
  effectId: string;
  envelope: EffectAdapterExecutionEnvelope<Payload>;
  input: AgentPurchaseIntentInput<Payload>;
  inputDigest: string;
  mandate?: Omit<SpendMandate, "signature">;
  mandateId: string;
  status: AgentPurchaseIntentStatus;
  updatedAt: number;
};

export type AgentPurchaseIntentStore = {
  get: (
    tenantId: string,
    purchaseId: string,
  ) => Promise<AgentPurchaseIntent | undefined>;
  getByIdempotencyKey: (
    tenantId: string,
    idempotencyKey: string,
  ) => Promise<AgentPurchaseIntent | undefined>;
  list: (input: {
    limit: number;
    ownerId?: string;
    status?: AgentPurchaseIntentStatus;
    tenantId?: string;
  }) => Promise<AgentPurchaseIntent[]>;
  save: (intent: AgentPurchaseIntent) => Promise<void>;
};

export class AgentPurchaseIntentError extends Error {}

const keyOf = (tenantId: string, purchaseId: string) =>
  `${tenantId}\u0000${purchaseId}`;

export const createMemoryAgentPurchaseIntentStore =
  (): AgentPurchaseIntentStore => {
    const records = new Map<string, AgentPurchaseIntent>();
    return {
      get: async (tenantId, purchaseId) => {
        const value = records.get(keyOf(tenantId, purchaseId));
        return value ? structuredClone(value) : undefined;
      },
      getByIdempotencyKey: async (tenantId, idempotencyKey) => {
        const value = [...records.values()].find(
          (intent) =>
            intent.input.tenantId === tenantId &&
            intent.input.idempotencyKey === idempotencyKey,
        );
        return value ? structuredClone(value) : undefined;
      },
      list: async (input) =>
        [...records.values()]
          .filter(
            ({ input: intent, status }) =>
              (!input.tenantId || intent.tenantId === input.tenantId) &&
              (!input.ownerId || intent.ownerId === input.ownerId) &&
              (!input.status || status === input.status),
          )
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, input.limit)
          .map((value) => structuredClone(value)),
      save: async (intent) => {
        const key = keyOf(intent.input.tenantId, intent.input.purchaseId);
        const existing = records.get(key);
        if (existing && existing.inputDigest !== intent.inputDigest)
          throw new AgentPurchaseIntentError(
            "Purchase identity belongs to another immutable request",
          );
        const idempotent = [...records.values()].find(
          ({ input }) =>
            input.tenantId === intent.input.tenantId &&
            input.idempotencyKey === intent.input.idempotencyKey,
        );
        if (
          idempotent &&
          idempotent.input.purchaseId !== intent.input.purchaseId
        )
          throw new AgentPurchaseIntentError(
            "Purchase idempotency key belongs to another request",
          );
        records.set(key, structuredClone(intent));
      },
    };
  };

const namespaceOf = (namespace: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(namespace))
    throw new AgentPurchaseIntentError(
      "Purchase intent namespace must be a simple identifier",
    );
  return namespace;
};

type AnyPgDatabase = PgAsyncDatabase<any, any>;
const portableJsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  fromDriver: (value) =>
    typeof value === "string" ? JSON.parse(value) : value,
  toDriver: (value) => JSON.stringify(value),
});
const encodedJsonb = <Value>(value: Value) =>
  sql<Value>`${JSON.stringify(value)}::text::jsonb`;

export const agentPurchaseIntentDrizzleSchema = (
  namespace = "agent_commerce",
) => {
  const schema = pgSchema(namespaceOf(namespace));
  const purchaseIntents = schema.table(
    "purchase_intents",
    {
      created_at: bigint({ mode: "number" }).notNull(),
      data: portableJsonb().$type<AgentPurchaseIntent>().notNull(),
      idempotency_key: text().notNull(),
      input_digest: text().notNull(),
      owner_id: text().notNull(),
      purchase_id: text().primaryKey(),
      status: text().$type<AgentPurchaseIntentStatus>().notNull(),
      tenant_id: text().notNull(),
      updated_at: bigint({ mode: "number" }).notNull(),
    },
    (table) => [
      uniqueIndex("purchase_intents_tenant_idempotency_idx").on(
        table.tenant_id,
        table.idempotency_key,
      ),
      uniqueIndex("purchase_intents_tenant_purchase_idx").on(
        table.tenant_id,
        table.purchase_id,
      ),
      index("purchase_intents_inventory_idx").on(
        table.tenant_id,
        table.created_at.desc(),
      ),
      index("purchase_intents_owner_idx").on(
        table.owner_id,
        table.created_at.desc(),
      ),
    ],
  );

  return { purchaseIntents };
};

export const createDrizzleAgentPurchaseIntentStore = <DB extends AnyPgDatabase>(
  db: DB,
  options: { namespace?: string } = {},
): AgentPurchaseIntentStore => {
  const { purchaseIntents } = agentPurchaseIntentDrizzleSchema(
    options.namespace,
  );
  const first = async (conditions: SQL[]) => {
    const [row] = await db
      .select({ data: purchaseIntents.data })
      .from(purchaseIntents)
      .where(and(...conditions))
      .limit(1);

    return row?.data;
  };

  return {
    get: (tenantId, purchaseId) =>
      first([
        eq(purchaseIntents.tenant_id, tenantId),
        eq(purchaseIntents.purchase_id, purchaseId),
      ]),
    getByIdempotencyKey: (tenantId, idempotencyKey) =>
      first([
        eq(purchaseIntents.tenant_id, tenantId),
        eq(purchaseIntents.idempotency_key, idempotencyKey),
      ]),
    list: async (input) => {
      const conditions: SQL[] = [];
      if (input.tenantId)
        conditions.push(eq(purchaseIntents.tenant_id, input.tenantId));
      if (input.ownerId)
        conditions.push(eq(purchaseIntents.owner_id, input.ownerId));
      if (input.status)
        conditions.push(eq(purchaseIntents.status, input.status));

      const rows = await db
        .select({ data: purchaseIntents.data })
        .from(purchaseIntents)
        .where(and(...conditions))
        .orderBy(desc(purchaseIntents.created_at))
        .limit(input.limit);

      return rows.map(({ data }) => data);
    },
    save: async (intent) => {
      const rows = await db
        .insert(purchaseIntents)
        .values({
          created_at: intent.createdAt,
          data: encodedJsonb(intent),
          idempotency_key: intent.input.idempotencyKey,
          input_digest: intent.inputDigest,
          owner_id: intent.input.ownerId,
          purchase_id: intent.input.purchaseId,
          status: intent.status,
          tenant_id: intent.input.tenantId,
          updated_at: intent.updatedAt,
        })
        .onConflictDoUpdate({
          set: {
            data: encodedJsonb(intent),
            status: intent.status,
            updated_at: intent.updatedAt,
          },
          setWhere: and(
            eq(purchaseIntents.tenant_id, intent.input.tenantId),
            eq(purchaseIntents.input_digest, intent.inputDigest),
            eq(purchaseIntents.idempotency_key, intent.input.idempotencyKey),
          ),
          target: purchaseIntents.purchase_id,
        })
        .returning({ id: purchaseIntents.purchase_id });
      if (rows.length !== 1)
        throw new AgentPurchaseIntentError(
          "Purchase identity belongs to another immutable request",
        );
    },
  };
};

export const agentPurchaseIntentsPostgresSchemaSql = (
  namespace = "agent_commerce",
) => {
  const ns = namespaceOf(namespace);
  return `CREATE SCHEMA IF NOT EXISTS ${ns};
CREATE TABLE IF NOT EXISTS ${ns}.purchase_intents (
  purchase_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  owner_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  input_digest text NOT NULL,
  data jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, purchase_id)
);
CREATE INDEX IF NOT EXISTS purchase_intents_inventory_idx ON ${ns}.purchase_intents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_intents_owner_idx ON ${ns}.purchase_intents (owner_id, created_at DESC);`;
};

type AgentPurchaseIntentRow = { data: AgentPurchaseIntent | string };
const parseRow = (row: AgentPurchaseIntentRow | undefined) => {
  if (!row) return undefined;
  return (
    typeof row.data === "string" ? JSON.parse(row.data) : row.data
  ) as AgentPurchaseIntent;
};

export const createPostgresAgentPurchaseIntentStore = (options: {
  client: ExecutionSqlClient;
  namespace?: string;
}): AgentPurchaseIntentStore => {
  const ns = namespaceOf(options.namespace ?? "agent_commerce");
  return {
    get: async (tenantId, purchaseId) =>
      parseRow(
        (
          await options.client.query<AgentPurchaseIntentRow>(
            `SELECT data FROM ${ns}.purchase_intents WHERE tenant_id = $1 AND purchase_id = $2`,
            [tenantId, purchaseId],
          )
        ).rows[0],
      ),
    getByIdempotencyKey: async (tenantId, idempotencyKey) =>
      parseRow(
        (
          await options.client.query<AgentPurchaseIntentRow>(
            `SELECT data FROM ${ns}.purchase_intents WHERE tenant_id = $1 AND idempotency_key = $2`,
            [tenantId, idempotencyKey],
          )
        ).rows[0],
      ),
    list: async (input) => {
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (input.tenantId) {
        values.push(input.tenantId);
        clauses.push(`tenant_id = $${values.length}`);
      }
      if (input.ownerId) {
        values.push(input.ownerId);
        clauses.push(`owner_id = $${values.length}`);
      }
      if (input.status) {
        values.push(input.status);
        clauses.push(`status = $${values.length}`);
      }
      values.push(input.limit);
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
      const result = await options.client.query<AgentPurchaseIntentRow>(
        `SELECT data FROM ${ns}.purchase_intents${where} ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return result.rows.map((row) => parseRow(row)!);
    },
    save: async (intent) => {
      const result = await options.client.query<{ purchase_id: string }>(
        `INSERT INTO ${ns}.purchase_intents
          (purchase_id, tenant_id, owner_id, idempotency_key, status, input_digest, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
         ON CONFLICT (purchase_id) DO UPDATE SET
          status = excluded.status,
          data = excluded.data,
          updated_at = excluded.updated_at
         WHERE ${ns}.purchase_intents.tenant_id = excluded.tenant_id
           AND ${ns}.purchase_intents.input_digest = excluded.input_digest
           AND ${ns}.purchase_intents.idempotency_key = excluded.idempotency_key
         RETURNING purchase_id`,
        [
          intent.input.purchaseId,
          intent.input.tenantId,
          intent.input.ownerId,
          intent.input.idempotencyKey,
          intent.status,
          intent.inputDigest,
          JSON.stringify(intent),
          intent.createdAt,
          intent.updatedAt,
        ],
      );
      if (result.rows.length !== 1)
        throw new AgentPurchaseIntentError(
          "Purchase identity belongs to another immutable request",
        );
    },
  };
};

type PurchaseWallet = {
  cancelSpend: (mandateId: string) => Promise<unknown>;
  requestSpend: (
    request: AgentSpendRequest,
    options?: { mandateId?: string },
  ) => Promise<SpendRequestResult>;
};

export const createAgentPurchaseOrchestrator = (options: {
  effects: Pick<EffectStore, "enqueue" | "getByIdempotencyKey">;
  installations: Pick<
    EffectAdapterInstallationRegistry,
    "disable" | "enable" | "put"
  >;
  now?: () => number;
  store: AgentPurchaseIntentStore;
  wallet: PurchaseWallet;
}) => {
  const now = options.now ?? Date.now;

  const saveStatus = async (
    intent: AgentPurchaseIntent,
    status: AgentPurchaseIntentStatus,
    mandate?: SpendMandate,
  ) => {
    let mandateSummary: Omit<SpendMandate, "signature"> | undefined;
    if (mandate) {
      const { signature, ...summary } = mandate;
      void signature;
      mandateSummary = summary;
    }
    const next: AgentPurchaseIntent = {
      ...intent,
      ...(mandateSummary ? { mandate: mandateSummary } : {}),
      status,
      updatedAt: now(),
    };
    await options.store.save(next);
    return next;
  };

  const submit = async <Payload>(
    input: AgentPurchaseIntentInput<Payload>,
  ): Promise<AgentPurchaseIntent<Payload>> => {
    if (!input.purchaseId.trim() || !input.idempotencyKey.trim())
      throw new AgentPurchaseIntentError(
        "Purchase and idempotency identities are required",
      );
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
      throw new AgentPurchaseIntentError(
        "Purchase amount must be positive integer minor units",
      );
    const mandateId = `mandate:purchase:${input.purchaseId}`;
    const effectId = `purchase:${input.purchaseId}`;
    const envelope: EffectAdapterExecutionEnvelope<Payload> = {
      currency: input.currency,
      ...(input.destination ? { destination: input.destination } : {}),
      effect: input.effect,
      installationId: input.installationId,
      mandateId,
      payload: input.payload,
      spendMinor: input.amountMinor,
    };
    const inputDigest = await effectAdapterExecutionInputDigest(envelope);
    const existing = await options.store.get(input.tenantId, input.purchaseId);
    const idempotent = await options.store.getByIdempotencyKey(
      input.tenantId,
      input.idempotencyKey,
    );
    const prior = existing ?? idempotent;
    if (prior) {
      if (
        prior.input.purchaseId !== input.purchaseId ||
        prior.inputDigest !== inputDigest
      )
        throw new AgentPurchaseIntentError(
          "Purchase identity belongs to another immutable request",
        );
      if (prior.status === "enqueued" || prior.status === "cancelled")
        return prior as AgentPurchaseIntent<Payload>;
    }
    let intent = (prior ?? {
      createdAt: now(),
      effectId,
      envelope,
      input,
      inputDigest,
      mandateId,
      status: "drafted" as const,
      updatedAt: now(),
    }) as AgentPurchaseIntent<Payload>;
    await options.store.save(intent);

    const spendRequest: AgentSpendRequest = {
      action: input.effect,
      agentId: input.agentId,
      allowanceId: input.allowanceId,
      amountCents: input.amountMinor,
      cartHash: inputDigest,
      ...(input.category ? { category: input.category } : {}),
      currency: input.currency,
      expiresAt: input.expiresAt,
      idempotencyKey: `purchase:${input.idempotencyKey}`,
      merchantId: input.merchantId,
      ...(input.refundable === undefined
        ? {}
        : { refundable: input.refundable }),
    };
    const requested = await options.wallet.requestSpend(spendRequest, {
      mandateId,
    });
    if (requested.mandate.status === "pending_approval")
      return (await saveStatus(
        intent,
        "pending_approval",
        requested.mandate,
      )) as AgentPurchaseIntent<Payload>;
    if (requested.mandate.status !== "active")
      throw new AgentPurchaseIntentError(
        `Purchase mandate is ${requested.mandate.status}`,
      );
    intent = (await saveStatus(
      intent,
      "mandate_ready",
      requested.mandate,
    )) as AgentPurchaseIntent<Payload>;

    await options.installations.put({
      adapterId: input.adapterId,
      installationId: input.installationId,
      policy: {
        credentials: input.credentials ?? [],
        destinations: input.destination ? [input.destination] : [],
        effects: [input.effect],
        spend: {
          currency: input.currency,
          mandateId,
          maxMinorPerEffect: input.amountMinor,
        },
      },
      tenantId: input.tenantId,
    });
    await options.installations.enable(input.tenantId, input.installationId);
    intent = (await saveStatus(
      intent,
      "installation_ready",
    )) as AgentPurchaseIntent<Payload>;

    const timestamp = now();
    const effect: EffectRecord = {
      actionId: input.actionId,
      attempts: 0,
      availableAt: timestamp,
      createdAt: timestamp,
      effectId,
      handler: input.handler,
      idempotencyKey: `purchase:${input.idempotencyKey}`,
      input: envelope,
      inputDigest,
      status: "pending",
      tenantId: input.tenantId,
      updatedAt: timestamp,
    };
    if (!(await options.effects.enqueue(effect))) {
      const duplicate = await options.effects.getByIdempotencyKey(
        input.tenantId,
        effect.idempotencyKey,
      );
      if (
        !duplicate ||
        duplicate.effectId !== effect.effectId ||
        duplicate.inputDigest !== effect.inputDigest
      ) {
        await options.installations.disable(
          input.tenantId,
          input.installationId,
        );
        await options.wallet.cancelSpend(mandateId);
        throw new AgentPurchaseIntentError(
          "Purchase effect idempotency key belongs to another request",
        );
      }
    }
    return (await saveStatus(
      intent,
      "enqueued",
    )) as AgentPurchaseIntent<Payload>;
  };

  return {
    list: options.store.list,
    submit,
  };
};
