import { describe, expect, test } from "bun:test";
import { readPageFromHash, resolveAppHashChange } from "../src/app-routing";
import { statisticsText } from "../src/statistics-i18n";
import type { Locale } from "../src/i18n/shared";

const LOCALES: Locale[] = ["en", "de", "fr", "ko", "zh", "zh-TW", "ru", "ja", "tr"];
const statisticsSource = await Bun.file(new URL("../src/pages/Statistics.tsx", import.meta.url)).text();

describe("statistics route", () => {
  test("resolves the dedicated statistics page without rewriting the hash", () => {
    expect(readPageFromHash("statistics")).toBe("statistics");
    expect(resolveAppHashChange("statistics")).toEqual({ page: "statistics", replaceTo: null });
  });
});

describe("statistics locale catalog", () => {
  test("uses the compile-checked main catalog for every supported GUI locale", () => {
    for (const locale of LOCALES) {
      expect(statisticsText(locale, "title").trim().length).toBeGreaterThan(0);
    }
  });

  test("uses Simplified and Traditional Chinese labels on the matching locale ids", () => {
    expect(statisticsText("zh", "title")).toBe("统计");
    expect(statisticsText("zh-TW", "title")).toBe("統計");
  });
});

describe("statistics single-page contract", () => {
  test("keeps quota rows focused on the current period without reset, remaining, or status columns", () => {
    expect(statisticsSource).toContain("row.periodStart");
    expect(statisticsSource).toContain("row.periodEnd");
    expect(statisticsSource).toContain("row.usedPercent");
    expect(statisticsSource).toContain("row.estimatedTotalTokens");
    expect(statisticsSource).toContain("row.estimatedTotalCostUsd");
    expect(statisticsSource).not.toContain("QuotaProjection");
    expect(statisticsSource).not.toContain("quotaResetText");
    expect(statisticsSource).not.toContain("remainingPercent");
    expect(statisticsSource).not.toContain("statusLabel");
  });

  test("shows cache hit and cache creation inside the input token surface", () => {
    const inputCellStart = statisticsSource.indexOf('className="num statistics-input-cell"');
    expect(inputCellStart).toBeGreaterThan(-1);
    const inputCell = statisticsSource.slice(inputCellStart, inputCellStart + 900);
    expect(inputCell).toContain("row.inputTokens");
    expect(inputCell).toContain("row.cacheReadInputTokens");
    expect(inputCell).toContain("row.cacheCreationInputTokens");
  });

  test("does not introduce separate analytics tabs or risk-warning surfaces", () => {
    expect(statisticsSource).not.toContain("<details");
    expect(statisticsSource).not.toContain("riskWarning");
    expect(statisticsSource).not.toContain("insights");
  });
});
