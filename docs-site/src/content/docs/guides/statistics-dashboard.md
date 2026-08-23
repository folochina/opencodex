---
title: Statistics Dashboard
description: Five-minute usage aggregates, current quota cycles, and display-time API cost estimates in the opencodex dashboard.
---

The web dashboard includes a **Statistics** page next to the existing **Usage** page. The two pages have different purposes: **Usage** keeps the existing log-derived coverage view, while **Statistics** stores a compact aggregate for longer-running usage, quota, and cost analysis.

## What is stored

Statistics are aggregated by:

- five-minute bucket;
- provider;
- privacy-safe account/log label;
- resolved model.

The aggregate stores request counts and token quantities only. It does not store prompts, responses, conversation text, or a second request-level history. Input tokens retain the provider-reported inclusive value together with **cache hit (cache input)** and **cache creation (cache write)** quantities so cached tokens are not double-counted.

The statistics reader catches up incrementally from the existing usage ledger. If its cursor falls outside the bounded management snapshot, it performs one full catch-up read and then resumes incremental reads.

## Automatic trend granularity

The chart chooses its display granularity from the selected time range:

| Selected range | Display bucket |
| --- | --- |
| Up to 1 hour | 5 minutes |
| More than 1 hour and up to 1 day | 1 hour |
| More than 1 day | 1 day |

Five minutes is the smallest persisted statistics bucket, so the chart never fabricates per-minute detail that was not stored.

## Current quota cycle

When a provider exposes both utilization and a reset boundary, Statistics shows the current quota cycle with:

- period start and period end;
- provider-reported used percentage;
- locally observed token usage for that period;
- estimated period token capacity;
- locally estimated API-equivalent cost for that period;
- estimated period cost capacity.

For a known window, the period start is derived from the provider reset boundary and the declared window duration. A provider-side reset therefore starts a new displayed period instead of being labeled as a special local reset event.

Estimated total capacity is calculated only when the aggregate contains the whole displayed period:

```text
estimated total = locally observed usage / provider used fraction
```

If opencodex does not have the complete current period, the total estimate is omitted rather than extrapolated from partial history. The estimate is an observation aid; provider subscription/risk-control accounting does not have to be linear in tokens or API list price.

## Prices and costs

Statistics does **not** persist cost values. Costs are recalculated when the page is read from the stored token quantities and the currently active display price.

The **Price settings** dialog uses the existing per-provider `modelCosts` configuration. Bundled verified/default prices are used when there is no user override. A custom override contains four USD-per-million-token rates:

- input (uncached input after subtracting cache read/write from the inclusive input total);
- cache read;
- cache write;
- output.

Removing the override returns that provider/model to the bundled verified/default price resolution.

As elsewhere in opencodex, these values are API list-price equivalents for reconciliation. They are not invoices and do not prove what a subscription provider charged.
