import { describe, expect, test } from "bun:test";

type PackageContract = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

const packageContract = (await Bun.file(
  new URL("../package.json", import.meta.url),
).json()) as PackageContract;
const lock = await Bun.file(new URL("../bun.lock", import.meta.url)).text();

describe("Agent dependency ownership", () => {
  test("owns one Agency version for every peer-based extension", () => {
    expect(packageContract.dependencies["@absolutejs/agency"]).toBe("^0.7.4");
    expect(packageContract.dependencies["@absolutejs/a2a"]).toBe("^0.3.6");
    expect(packageContract.dependencies["@absolutejs/agent-control"]).toBe(
      "^0.5.7",
    );
    expect(packageContract.dependencies["@absolutejs/manifest"]).toBe("^0.9.0");
    expect(packageContract.dependencies["@absolutejs/mcp"]).toBe("^0.21.0");
    expect(packageContract.dependencies["@absolutejs/policy"]).toBe("^0.3.0");
    expect(packageContract.dependencies["@absolutejs/wallet"]).toBe("^0.9.3");

    const versions = new Set(
      [...lock.matchAll(/@absolutejs\/agency@(\d+\.\d+\.\d+)/g)].map(
        (match) => match[1],
      ),
    );
    expect([...versions]).toEqual(["0.7.4"]);
    expect(lock).not.toMatch(/"[^"]+\/@absolutejs\/agency":/);
  });

  test("shares the nominal Execution and Auth runtimes with facade consumers", () => {
    expect(
      packageContract.dependencies["@absolutejs/execution"],
    ).toBeUndefined();
    expect(packageContract.devDependencies["@absolutejs/execution"]).toBe(
      "0.14.6",
    );
    expect(packageContract.peerDependencies["@absolutejs/execution"]).toBe(
      ">=0.14.6 <0.15",
    );
    expect(lock).not.toMatch(/"[^"]+\/@absolutejs\/execution":/);

    expect(packageContract.dependencies["@absolutejs/auth"]).toBeUndefined();
    expect(packageContract.devDependencies["@absolutejs/auth"]).toBe("0.65.0");
    expect(packageContract.peerDependencies["@absolutejs/auth"]).toBe(
      ">=0.57.6 <1",
    );
    expect(lock).not.toMatch(/"[^"]+\/@absolutejs\/auth":/);
  });
});

test("MCP facade exports checkout factories from the installed artifact", async () => {
  const mcp = await import("../src/mcp");
  expect(typeof mcp.createCheckoutHandoffTool).toBe("function");
  expect(typeof mcp.createPurchaseStatusTool).toBe("function");
});

test("MCP facade exports billing factories from the installed artifact", async () => {
  const mcp = await import("../src/mcp");
  expect(typeof mcp.createBillingReportTools).toBe("function");
  expect(typeof mcp.createBillingManagementTool).toBe("function");
});

test("MCP facade includes bundled billing Apps and immutable migrations", async () => {
  const mcp = await import("../src/mcp");
  const apps = mcp.createBillingApps();
  expect(Object.keys(apps.resources)).toHaveLength(3);
  expect(apps.resources["ui://absolute-billing/status.html"]?.html).toContain(
    '<script type="module">',
  );
  expect(mcp.mcpPostgresMigrations().map((row) => row.id)).toEqual([
    "mcp@0.10.1",
    "mcp@0.17.0",
  ]);
});

test("MCP facade exposes workflow tools and selection confirmation resources", async () => {
  const mcp = await import("../src/mcp");
  expect(typeof mcp.createWorkflowTools).toBe("function");
  expect(typeof mcp.createSetupSelectionTools).toBe("function");
  expect(typeof mcp.createActionWorkflowTools).toBe("function");
  expect(Object.keys(mcp.createWorkflowApps().resources)).toEqual([
    "ui://absolute-workflow/setup.html",
    "ui://absolute-workflow/action.html",
    "ui://absolute-workflow/selection.html",
    "ui://absolute-workflow/preview.html",
  ]);
});
