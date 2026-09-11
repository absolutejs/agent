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
    expect(packageContract.dependencies["@absolutejs/mcp"]).toBe("^0.14.0");
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
