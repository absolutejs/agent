import { describe, expect, test } from "bun:test";
import {
  assertProductionReady,
  defineAgentStack,
  PRODUCTION_AGENT_CAPABILITIES,
} from "../src/index";

describe("agent stack", () => {
  test("preserves named component types and reports missing capabilities", async () => {
    const runtime = { run: () => "ok" };
    const stack = defineAgentStack([
      { capability: "durability", instance: runtime, name: "runtime" },
    ] as const);
    expect(stack.get("runtime").run()).toBe("ok");
    const readiness = await stack.readiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.capabilities.durability).toBe(true);
    expect(readiness.missing).toContain("identity");
  });

  test("accepts a complete ready stack", async () => {
    const components = PRODUCTION_AGENT_CAPABILITIES.map((capability) => ({
      capability,
      instance: capability,
      name: capability,
    }));
    const readiness = await assertProductionReady(defineAgentStack(components));
    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });

  test("rejects duplicate component names", () => {
    expect(() =>
      defineAgentStack([
        { capability: "identity", instance: {}, name: "duplicate" },
        { capability: "trust", instance: {}, name: "duplicate" },
      ]),
    ).toThrow("Duplicate agent stack component");
  });
});
