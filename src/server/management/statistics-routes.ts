import {
  hasOwnProvider,
  isValidProviderName,
  saveConfigPreservingClaudeCode,
  withConfigMutationLockSync,
} from "../../config";
import { reconcileLiveStateStores } from "../../lib/state-store-registrations";
import {
  buildStatisticsResponse,
  statisticsPriceRows,
  type StatisticsQuery,
} from "../../statistics";
import {
  isValidCost4Rate,
  refreshUserCostOverlays,
  type COST4_RATE_KEYS,
} from "../../usage/user-cost-overlays";
import type { ProviderCostOverlay } from "../../types";
import { jsonResponse } from "../auth-cors";
import { readManagementJsonBody, rethrowManagementBodyTooLarge } from "./body";
import type { ManagementContext } from "./context";

function parseTime(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalFilter(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function statisticsQuery(url: URL, now: number): StatisticsQuery {
  const defaultFrom = now - 7 * 24 * 60 * 60_000;
  const from = parseTime(url.searchParams.get("from"), defaultFrom);
  const to = parseTime(url.searchParams.get("to"), now);
  return {
    from,
    to,
    ...(optionalFilter(url.searchParams.get("provider")) ? { provider: optionalFilter(url.searchParams.get("provider")) } : {}),
    ...(optionalFilter(url.searchParams.get("account")) ? { account: optionalFilter(url.searchParams.get("account")) } : {}),
    ...(optionalFilter(url.searchParams.get("model")) ? { model: optionalFilter(url.searchParams.get("model")) } : {}),
  };
}

function validCost4(value: unknown): value is ProviderCostOverlay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return ["input", "output", "cacheRead", "cacheWrite"].every(key => isValidCost4Rate(row[key]));
}

export async function handleStatisticsRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { req, url, config } = ctx;

  if (url.pathname === "/api/statistics" && req.method === "GET") {
    try {
      return jsonResponse(await buildStatisticsResponse(config, statisticsQuery(url, Date.now())));
    } catch (error) {
      if (error instanceof RangeError) return jsonResponse({ error: error.message }, 400);
      throw error;
    }
  }

  if (url.pathname === "/api/statistics/prices" && req.method === "GET") {
    return jsonResponse({ prices: await statisticsPriceRows() });
  }

  if (url.pathname === "/api/statistics/prices" && req.method === "PUT") {
    let body: unknown;
    try {
      body = await readManagementJsonBody(req);
    } catch (error) {
      rethrowManagementBodyTooLarge(error);
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({ error: "price body must be an object" }, 400);
    }
    const raw = body as Record<string, unknown>;
    const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
    const model = typeof raw.model === "string" ? raw.model.trim() : "";
    if (!provider || !isValidProviderName(provider) || !hasOwnProvider(config.providers, provider)) {
      return jsonResponse({ error: "unknown provider" }, 404);
    }
    if (!model) return jsonResponse({ error: "model is required" }, 400);
    if (raw.cost4 !== null && !validCost4(raw.cost4)) {
      return jsonResponse({ error: "cost4 requires input, output, cacheRead, and cacheWrite rates" }, 400);
    }

    withConfigMutationLockSync(() => {
      const current = config.providers[provider]!;
      const modelCosts = { ...(current.modelCosts ?? {}) };
      if (raw.cost4 === null) delete modelCosts[model];
      else modelCosts[model] = raw.cost4 as ProviderCostOverlay;
      config.providers[provider] = {
        ...current,
        ...(Object.keys(modelCosts).length > 0 ? { modelCosts } : {}),
      };
      if (Object.keys(modelCosts).length === 0) delete config.providers[provider]!.modelCosts;
      saveConfigPreservingClaudeCode(config);
    });
    reconcileLiveStateStores();
    refreshUserCostOverlays(config);
    return jsonResponse({ success: true, provider, model });
  }

  return null;
}
