import { describe, expect, test } from "bun:test";
import { statisticsGranularity } from "../src/statistics";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("statisticsGranularity", () => {
  test("uses 5-minute buckets within one hour", () => {
    expect(statisticsGranularity(0, HOUR)).toBe("5m");
    expect(statisticsGranularity(0, HOUR - 1)).toBe("5m");
  });

  test("uses hourly buckets within one day", () => {
    expect(statisticsGranularity(0, HOUR + 1)).toBe("1h");
    expect(statisticsGranularity(0, DAY)).toBe("1h");
  });

  test("uses daily buckets for ranges longer than one day", () => {
    expect(statisticsGranularity(0, DAY + 1)).toBe("1d");
    expect(statisticsGranularity(0, 7 * DAY)).toBe("1d");
    expect(statisticsGranularity(0, 30 * DAY)).toBe("1d");
  });
});
