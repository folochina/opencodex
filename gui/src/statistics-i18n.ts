import { catalogValue, type Locale } from "./i18n/catalogs";

/**
 * Statistics uses the compile-checked main locale catalog. Keep this tiny adapter only
 * so the App sidebar can label the new page without widening its existing page-key map.
 */
export function statisticsText(locale: Locale, _key: "title"): string {
  return catalogValue(locale, "pws.statsTitle");
}
