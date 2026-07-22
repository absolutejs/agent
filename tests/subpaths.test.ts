import { expect, test } from "bun:test";
import { A2A_PROTOCOL_VERSION } from "../src/a2a";
import { ARAZZO_VERSION } from "../src/arazzo";
import {
  allowAllPolicy,
  createAuthAgencyDelegationAuthority,
} from "../src/actions";
import { AGENT_CLAIM_GRANT_TYPE } from "../src/auth";
import { conformanceCatalog } from "../src/conformance";
import { createMemoryAgentPurchaseIntentStore } from "../src/commerce";
import { createMemoryOperationStore } from "../src/control";
import { ABSOLUTE_AGENT_PATH } from "../src/discovery";
import { createMemoryEffectStore } from "../src/execution";
import { createMemoryAgentInboxStore } from "../src/inbox";
import { createMcpHandler } from "../src/mcp";
import { createMemoryAgentMemoryStore } from "../src/memory";
import { createMemoryPolicyStore } from "../src/policy";
import { createMemoryAgentRuntimeStore } from "../src/runtime";
import { createMemoryAgentSandboxOperationStore } from "../src/sandbox";
import { AGENT_ACTION_POLICY } from "../src/trust";
import { createMemoryAgentWalletStore } from "../src/wallet";
import { bootstrapWebMcpHttpActions } from "../src/webmcp";

test("stable subpaths expose every agent engine", () => {
  expect(A2A_PROTOCOL_VERSION).toBe("1.0");
  expect(ARAZZO_VERSION).toBe("1.1.0");
  expect(allowAllPolicy).toBeFunction();
  expect(createAuthAgencyDelegationAuthority).toBeFunction();
  expect(AGENT_CLAIM_GRANT_TYPE).toContain("agent-auth");
  expect(conformanceCatalog.length).toBeGreaterThan(0);
  expect(createMemoryAgentPurchaseIntentStore).toBeFunction();
  expect(createMemoryOperationStore).toBeFunction();
  expect(ABSOLUTE_AGENT_PATH).toContain("well-known");
  expect(createMemoryEffectStore).toBeFunction();
  expect(createMemoryAgentInboxStore).toBeFunction();
  expect(createMcpHandler).toBeFunction();
  expect(createMemoryAgentMemoryStore).toBeFunction();
  expect(createMemoryPolicyStore).toBeFunction();
  expect(createMemoryAgentRuntimeStore).toBeFunction();
  expect(createMemoryAgentSandboxOperationStore).toBeFunction();
  expect(AGENT_ACTION_POLICY.allowedPurposes).toContain("tool-output");
  expect(createMemoryAgentWalletStore).toBeFunction();
  expect(bootstrapWebMcpHttpActions).toBeFunction();
});
