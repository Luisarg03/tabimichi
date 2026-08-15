import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { logEntry, readLogTail, setLogDir, logFilePath } from "@/lib/logger";
import { isolatedStore } from "@/test-utils/helpers";

describe("logger", () => {
  beforeEach(() => isolatedStore());

  it("persists entries as JSON Lines", () => {
    logEntry({ type: "recommend", lat: 36.6, scored: 8 });
    logEntry({ type: "recommend", lat: 34.7, scored: 0, emptyReason: "all_closed" });
    const file = logFilePath();
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].type).toBe("recommend");
    expect(parsed[1].emptyReason).toBe("all_closed");
  });

  it("reads the tail newest-first and tolerates missing files", () => {
    expect(readLogTail(10)).toEqual([]);
    for (let i = 1; i <= 5; i++) logEntry({ n: i });
    const tail = readLogTail(3);
    expect(tail.map((e) => (e as { n: number }).n)).toEqual([5, 4, 3]);
  });

  it("never throws on write failure (bad dir)", () => {
    setLogDir(path.join("", "\0", "nope")); // invalid path on most systems
    expect(() => logEntry({ x: 1 })).not.toThrow();
  });
});
