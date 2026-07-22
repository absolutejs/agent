export const AGENT_STACK_PACKAGES = {
  a2a: "@absolutejs/a2a",
  actions: "@absolutejs/agency",
  auth: "@absolutejs/auth",
  conformance: "@absolutejs/agent-conformance",
  commerce: "@absolutejs/agent/commerce",
  control: "@absolutejs/agent-control",
  discovery: "@absolutejs/agent-discovery",
  execution: "@absolutejs/execution",
  inbox: "@absolutejs/agent-inbox",
  mcp: "@absolutejs/mcp",
  memory: "@absolutejs/agent-memory",
  policy: "@absolutejs/policy",
  runtime: "@absolutejs/agent-runtime",
  sandbox: "@absolutejs/agent-sandbox",
  trust: "@absolutejs/agent-trust",
  wallet: "@absolutejs/wallet",
} as const;

export const PRODUCTION_AGENT_CAPABILITIES = [
  "identity",
  "authorization",
  "durability",
  "sandbox",
  "trust",
  "memory",
  "triggers",
  "discovery",
  "interoperability",
  "spend",
  "operations",
  "conformance",
] as const;

export type ProductionAgentCapability =
  (typeof PRODUCTION_AGENT_CAPABILITIES)[number];

export type AgentStackComponent<Instance = unknown> = {
  capability: ProductionAgentCapability;
  instance: Instance;
  name: string;
  productionReady?: () => boolean | Promise<boolean>;
};

export type AgentStack<Components extends readonly AgentStackComponent[]> = {
  components: Components;
  get: <Name extends Components[number]["name"]>(
    name: Name,
  ) => Extract<Components[number], { name: Name }>["instance"];
  readiness: () => Promise<AgentStackReadiness>;
};

export type AgentStackReadiness = {
  capabilities: Record<ProductionAgentCapability, boolean>;
  missing: ProductionAgentCapability[];
  ready: boolean;
};

const readinessOf = async (
  components: readonly AgentStackComponent[],
): Promise<AgentStackReadiness> => {
  const capabilities = Object.fromEntries(
    PRODUCTION_AGENT_CAPABILITIES.map((capability) => [capability, false]),
  ) as Record<ProductionAgentCapability, boolean>;
  for (const component of components) {
    if ((await component.productionReady?.()) === false) continue;
    capabilities[component.capability] = true;
  }
  const missing = PRODUCTION_AGENT_CAPABILITIES.filter(
    (capability) => !capabilities[capability],
  );

  return { capabilities, missing, ready: missing.length === 0 };
};

export const defineAgentStack = <
  const Components extends readonly AgentStackComponent[],
>(
  components: Components,
): AgentStack<Components> => {
  const names = new Set<string>();
  for (const component of components) {
    if (names.has(component.name)) {
      throw new Error(`Duplicate agent stack component: ${component.name}`);
    }
    names.add(component.name);
  }

  return {
    components,
    get: (name) => {
      const component = components.find((candidate) => candidate.name === name);
      if (component === undefined) {
        throw new Error(`Unknown agent stack component: ${String(name)}`);
      }

      return component.instance as Extract<
        Components[number],
        { name: typeof name }
      >["instance"];
    },
    readiness: () => readinessOf(components),
  };
};

export const assertProductionReady = async (
  stack: Pick<AgentStack<readonly AgentStackComponent[]>, "readiness">,
) => {
  const readiness = await stack.readiness();
  if (!readiness.ready) {
    throw new Error(
      `Agent stack is missing production capabilities: ${readiness.missing.join(", ")}`,
    );
  }

  return readiness;
};
