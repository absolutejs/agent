import { describe, expect, test } from "bun:test";
import {
  createAgentPurchaseOrchestrator,
  createMemoryAgentPurchaseIntentStore,
} from "../src/commerce";
import {
  createMemoryEffectStore,
  effectAdapterExecutionInputDigest,
} from "@absolutejs/execution";
import type { SpendMandate } from "@absolutejs/wallet";

const input = () => ({
  actionId: "action-1",
  adapterId: "commerce.test",
  agentId: "agent-1",
  allowanceId: "allowance-1",
  amountMinor: 1299,
  currency: "USD",
  destination: "merchant.test",
  effect: "purchase.create",
  expiresAt: "2030-01-01T00:00:00.000Z",
  handler: "adapter:commerce.test",
  idempotencyKey: "checkout-1",
  installationId: "purchase-installation-1",
  merchantId: "merchant-1",
  ownerId: "owner-1",
  payload: { lines: [{ quantity: 1, sku: "sku-1" }] },
  purchaseId: "purchase-1",
  refundable: true,
  tenantId: "tenant-1",
});

const setup = (mandateStatus: SpendMandate["status"] = "active") => {
  const events: string[] = [];
  const effects = createMemoryEffectStore();
  const wallet = {
    cancelSpend: async () => {
      events.push("mandate.cancel");
      return {} as never;
    },
    requestSpend: async (
      request: Parameters<
        Parameters<
          typeof createAgentPurchaseOrchestrator
        >[0]["wallet"]["requestSpend"]
      >[0],
      options?: { mandateId?: string },
    ) => {
      events.push("mandate.request");
      const mandate: SpendMandate = {
        ...request,
        bindingDigest: "signed-binding",
        createdAt: "2026-01-01T00:00:00.000Z",
        mandateId: options?.mandateId ?? "generated",
        reservationId: "reservation-1",
        signature: "signature",
        status: mandateStatus,
      };
      return { mandate };
    },
  };
  const installations = {
    disable: async () => {
      events.push("installation.disable");
    },
    enable: async () => {
      events.push("installation.enable");
    },
    put: async () => {
      events.push("installation.put");
      return {} as never;
    },
  };
  const orchestrator = createAgentPurchaseOrchestrator({
    effects: {
      enqueue: async (effect) => {
        events.push("effect.enqueue");
        return effects.enqueue(effect);
      },
      getByIdempotencyKey: effects.getByIdempotencyKey,
    },
    installations,
    now: () => 1_000,
    store: createMemoryAgentPurchaseIntentStore(),
    wallet,
  });
  return { effects, events, orchestrator };
};

describe("agent purchase orchestration", () => {
  test("binds the exact envelope before requesting and enqueuing spend", async () => {
    const { effects, events, orchestrator } = setup();
    const purchase = await orchestrator.submit(input());
    const effect = await effects.get("purchase:purchase-1");

    expect(purchase.status).toBe("enqueued");
    expect(purchase.mandateId).toBe("mandate:purchase:purchase-1");
    expect(purchase.inputDigest).toBe(
      await effectAdapterExecutionInputDigest(purchase.envelope),
    );
    expect(purchase.mandate?.cartHash).toBe(purchase.inputDigest);
    expect(effect?.inputDigest).toBe(purchase.inputDigest);
    expect(events).toEqual([
      "mandate.request",
      "installation.put",
      "installation.enable",
      "effect.enqueue",
    ]);

    expect(await orchestrator.submit(input())).toEqual(purchase);
    expect(events).toHaveLength(4);
  });

  test("retains approval-gated purchases without installing or enqueueing", async () => {
    const { effects, events, orchestrator } = setup("pending_approval");
    const purchase = await orchestrator.submit(input());

    expect(purchase.status).toBe("pending_approval");
    expect(await effects.get("purchase:purchase-1")).toBeUndefined();
    expect(events).toEqual(["mandate.request"]);
  });

  test("rejects an idempotency key rebound to another cart", async () => {
    const { orchestrator } = setup();
    await orchestrator.submit(input());

    await expect(
      orchestrator.submit({
        ...input(),
        payload: { lines: [{ quantity: 2, sku: "sku-1" }] },
      }),
    ).rejects.toThrow("immutable request");
  });
});
