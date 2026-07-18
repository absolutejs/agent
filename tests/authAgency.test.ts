import { describe, expect, test } from "bun:test";
import { createInMemoryAgentDelegationStore } from "@absolutejs/auth/agents";
import {
  authAgencyAuthorizationDetail,
  createAuthAgencyDelegationAuthority,
} from "../src/authAgency";

const now = 1_000;
const action = {
  action: "project.summary.read",
  actor: {
    agentId: "builder-agent",
    delegationId: "agd_1",
    scopes: ["projects:read"],
    userId: "owner-1",
  },
  context: { audience: "https://paas.example" },
  effects: ["read"],
  input: { projectId: "project-1" },
  resource: { id: "project-1", type: "project" },
} as const;

const fixture = async () => {
  const store = createInMemoryAgentDelegationStore();
  await store.saveDelegation({
    agentId: "builder-agent",
    authorizationDetails: [
      authAgencyAuthorizationDetail({
        actions: ["project.summary.read"],
        audience: "https://paas.example",
        effects: ["read"],
        resourceIds: ["project-1"],
        resourceTypes: ["project"],
      }),
    ],
    createdAt: now - 1,
    delegationId: "agd_1",
    expiresAt: now + 1_000,
    scopes: ["projects:read"],
    status: "active",
    updatedAt: now - 1,
    userId: "owner-1",
  });

  return {
    authority: createAuthAgencyDelegationAuthority({ now: () => now, store }),
    store,
  };
};

describe("Auth-to-Agency delegation bridge", () => {
  test("reuses the authenticated delegation without a shadow grant", async () => {
    const { authority } = await fixture();

    expect(await authority.assertAllows(action)).toEqual({
      expiresAt: now + 1_000,
    });
  });

  test("fails closed across actor, audience, action, effect, and resource", async () => {
    const { authority } = await fixture();
    const variants = [
      { ...action, action: "project.files.delete" },
      { ...action, context: { audience: "https://other.example" } },
      { ...action, effects: ["delete"] },
      { ...action, resource: { id: "project-2", type: "project" } },
      { ...action, actor: { ...action.actor, userId: "owner-2" } },
    ];

    for (const variant of variants)
      await expect(authority.assertAllows(variant)).rejects.toThrow();
  });

  test("re-reads revocation and expiry on every authorization check", async () => {
    const { authority, store } = await fixture();
    await store.saveDelegation({
      agentId: "builder-agent",
      authorizationDetails: [
        authAgencyAuthorizationDetail({
          actions: ["project.summary.read"],
          audience: "https://paas.example",
          effects: ["read"],
          resourceTypes: ["project"],
        }),
      ],
      createdAt: now - 1,
      delegationId: "agd_1",
      expiresAt: now + 1_000,
      scopes: ["projects:read"],
      status: "revoked",
      updatedAt: now,
      userId: "owner-1",
    });

    await expect(authority.assertAllows(action)).rejects.toThrow("revoked");
  });
});
