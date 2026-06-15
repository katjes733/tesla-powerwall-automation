# Schedule Implementation Tracker

- [Schedule Implementation Tracker](#schedule-implementation-tracker)
  - [Overview](#overview)
  - [Actions](#actions)
  - [Conditions: Powerwall Tab](#conditions-powerwall-tab)
  - [Conditions: Flow Tab](#conditions-flow-tab)
  - [Summary](#summary)

## Overview

Schedules are configured in the UI across three tabs (TIME, POWERWALL, FLOW) and persisted to the database. At runtime, `Scheduler` (a singleton backed by `node-cron`) fires each schedule on its cron expression and is expected to:

1. Evaluate any **conditions** stored in `schedule.conditions` (JSONB) — e.g. battery charge level, energy flow thresholds, time window
2. If conditions pass, invoke each **action** from `schedule.actions` (JSONB) by looking it up in `Fleet._actionMap` and calling the corresponding Tesla Fleet API method

This document tracks which actions and conditions are fully wired up end-to-end versus those that are stored-only or entirely missing.

**Key source files:**
- UI: `src/client/components/schedules/Schedules.tsx`
- Scheduler: `src/server/util/scheduler.ts`
- Fleet API wrapper: `src/server/util/fleet.ts`
- DB model: `src/server/database/models/schedule.ts`

## Actions

**Status legend:**
- `✅ Complete` — stored AND executed correctly end-to-end
- `❌ Not implemented` — no Fleet method exists; execution logic is entirely missing

| Action (UI Label) | UI Key (stored in DB) | Fleet Method | Implemented | Execution Status | Notes |
|---|---|---|---|---|---|
| Set backup reserve | `setBackupReserve` | `setBackupReserve` | ✅ | ✅ Complete | |
| Preserve battery charge | `setSoftBackupReserve` | `setSoftBackupReserve` | ✅ | ✅ Complete | Checks live battery % before setting reserve |
| Set operational mode | `setOperationalMode` | `setOperationalMode` | ✅ | ✅ Complete | Maps `selfPowered` → `self_consumption`, `timeBasedControl` → `autonomous` |
| Set energy exports | `setEnergyExports` | `setEnergyExports` | ✅ | ✅ Complete | Maps `solarOnly` → `pv_only`, `everything` → `battery_ok`; uses `POST grid_import_export` |
| Set grid charging | `setGridCharging` | `setGridCharging` | ✅ | ✅ Complete | Maps `enabled` → `disallow=false`, `disabled` → `disallow=true`; uses `POST grid_import_export` |

## Conditions: Powerwall Tab

Conditions are stored in `schedule.conditions` (JSONB array) and evaluated on every cron tick via `evaluatePowerwallConditions()` in `scheduler.ts`. A **rising-edge trigger** (`triggeredPerProduct` map, closure-scoped per schedule task) ensures each action fires once when the condition transitions from unmet → met, is suppressed while the condition remains met, and resets automatically when the condition clears — ready to fire again on the next rising edge.

`betweenHours` is always a secondary gate; it is never the sole condition. The evaluator checks `betweenHours` first (no API call needed), then calls `Fleet.getLiveStatus()` to evaluate the primary battery condition.

| Condition (UI Label) | UI Key | Stored in DB | Evaluated at Runtime | Notes |
|---|---|---|---|---|
| Charged up to X% | `charged` | ✅ | ✅ | Rising-edge trigger: fires once when `percentage_charged ≥ value`, resets when it drops below |
| Discharged down to X% | `discharged` | ✅ | ✅ | Rising-edge trigger: fires once when `percentage_charged ≤ value`, resets when it rises above |
| Discharged down to backup reserve | `backup` | ✅ | ✅ | Rising-edge trigger: calls `getSiteInfo()` per tick to get the current `backup_reserve_percent` dynamically; fires once when `percentage_charged ≤ backup_reserve_percent` |
| Only between hours (optional) | `betweenHours` | ✅ | ✅ | Evaluated as a secondary gate alongside the primary condition; supports overnight windows |

## Conditions: Flow Tab

Same root cause as Powerwall conditions — `schedule.conditions` is never read by the scheduler. Evaluating these would require `Fleet.getLiveStatus()` at tick time to get real-time kW readings (`solar_power`, `load_power`, `grid_power`, etc.).

| Condition (UI Label) | UI Key | Stored in DB | Evaluated at Runtime | Notes |
|---|---|---|---|---|
| When home usage rises above X kW | `homeUsageAbove` | ✅ | ❌ | Guard: `load_power > value` |
| When home usage drops to or below X kW | `homeUsageBelow` | ✅ | ❌ | Guard: `load_power ≤ value` |
| When solar generation rises above X kW | `solarGenerationAbove` | ✅ | ❌ | Guard: `solar_power > value` |
| When solar generation drops to or below X kW | `solarGenerationBelow` | ✅ | ❌ | Guard: `solar_power ≤ value` |
| When grid import rises above X kW | `gridImportAbove` | ✅ | ❌ | Guard: `grid_power > value` (import) |
| When grid import drops to or below X kW | `gridImportBelow` | ✅ | ❌ | Guard: `grid_power ≤ value` (import) |
| When grid export rises above X kW | `gridExportAbove` | ✅ | ❌ | Guard: `grid_power > value` (export) |
| When grid export drops to or below X kW | `gridExportBelow` | ✅ | ❌ | Guard: `grid_power ≤ value` (export) |
| Only between hours (optional) | `betweenHours` | ✅ | ❌ | Time-window guard; stored alongside the flow condition |

## Summary

| Category | Total items | Complete | Not implemented |
|---|---|---|---|
| Actions | 5 | 5 | 0 |
| Powerwall conditions | 4 | 4 | 0 |
| Flow conditions | 9 | 0 | 9 |
| **Total** | **18** | **9** | **9** |

All five actions and all four Powerwall conditions execute end-to-end. Next step: extend condition evaluation to the Flow tab (9 conditions).
