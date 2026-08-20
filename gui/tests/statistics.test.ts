import { describe, expect, test } from "bun:test";
import { readPageFromHash, resolveAppHashChange } from "../src/app-routing";
import { statisticsText } from "../src/statistics-i18n";
import type { Locale } from "../src/i18n/shared";

const LOCALES: Locale[] = ["en", "de", "fr", "ko", "zh", "zh-TW", "ru", "ja", "tr"];

describe("statistics route", () => {
  test("resolves the dedicated statistics page without rewriting the hash", () => {
    expect(readPageFromHash("statistics")).toBe("statistics");
    expect(resolveAppHashChange("statistics")).toEqual({ page: "statistics", replaceTo: null });
  });
});

describe("statistics locale catalog", () => {
  test("covers every supported GUI locale", () => {
    for (const locale of LOCALES) {
      expect(statisticsText(locale, "title").trim().length).toBeGreaterThan(0);
      expect(statisticsText(locale, "unpriced").trim().length).toBeGreaterThan(0);
    }
  });

  test("uses Simplified and Traditional Chinese labels on the matching locale ids", () => {
    expect(statisticsText("zh", "title")).toBe("统计");
    expect(statisticsText("zh-TW", "title")).toBe("統計");
  });
});
