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
    expect(packageContract.dependencies["@absolutejs/agency"]).toBe("^0.7.1");
    expect(packageContract.dependencies["@absolutejs/a2a"]).toBe("^0.3.5");
    expect(packageContract.dependencies["@absolutejs/agent-control"]).toBe(
      "^0.5.6",
    );
    expect(packageContract.dependencies["@absolutejs/auth"]).toBe("^0.57.3");
    expect(packageContract.dependencies["@absolutejs/manifest"]).toBe("^0.7.1");
    expect(packageContract.dependencies["@absolutejs/mcp"]).toBe("^0.11.3");
    expect(packageContract.dependencies["@absolutejs/policy"]).toBe("^0.3.0");
    expect(packageContract.dependencies["@absolutejs/wallet"]).toBe("^0.9.3");

    const versions = new Set(
      [...lock.matchAll(/@absolutejs\/agency@(\d+\.\d+\.\d+)/g)].map(
        (match) => match[1],
      ),
    );
    expect([...versions]).toEqual(["0.7.1"]);
    expect(lock).not.toMatch(/"[^"]+\/@absolutejs\/agency":/);
  });

  test("shares the nominal Execution runtime with facade consumers", () => {
    expect(packageContract.dependencies["@absolutejs/execution"]).toBeUndefined();
    expect(packageContract.devDependencies["@absolutejs/execution"]).toBe(
      "0.14.6",
    );
    expect(packageContract.peerDependencies["@absolutejs/execution"]).toBe(
      ">=0.14.6 <0.15",
    );
    expect(lock).not.toMatch(/"[^"]+\/@absolutejs\/execution":/);
  });
});
