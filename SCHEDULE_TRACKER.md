# Schedule Implementation Tracker

- [Schedule Implementation Tracker](#schedule-implementation-tracker)
  - [Overview](#overview)
  - [Known Bugs](#known-bugs)
    - [Action key mismatch](#action-key-mismatch)
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

## Known Bugs

### Action key mismatch

**All actions are silently skipped at runtime**, even for Fleet methods that exist.

The scheduler resolves actions by looking up `config.action` directly in `Fleet._actionMap` (`scheduler.ts` line 65). The `_actionMap` is built by reflecting over Fleet prototype methods whose names start with `set` — so its keys are the method names themselves (e.g. `setBackupReserve`).

However, the UI stores action keys without the `set` prefix (e.g. `backupReserve`). These never match, so the scheduler logs a warning and skips every action on every tick.

| Affected file | Location | Role |
|---|---|---|
| `src/server/util/scheduler.ts` | lines 65 and 110 | action lookup and invocation |
| `src/server/util/fleet.ts` | lines 43–52 | `_actionMap` construction |

**Fix options:**
- Rename the UI action keys to match method names (e.g. `backupReserve` → `setBackupReserve`)
- Or add a `set` + capitalise transform in the scheduler before the lookup

## Actions

**Status legend:**
- `✅ Complete` — stored AND executed correctly end-to-end
- `⚠️ Partial` — Fleet method exists but is unreachable due to the key mismatch bug above
- `❌ Not implemented` — no Fleet method exists; execution logic is entirely missing

| Action (UI Label) | UI Key (stored in DB) | Required Fleet Method | Fleet Method Exists | Execution Status | Notes |
|---|---|---|---|---|---|
| Set backup reserve | `backupReserve` | `setBackupReserve` | ✅ | ⚠️ Partial | Blocked by key mismatch bug |
| Preserve battery charge | `preserveCharge` | `setSoftBackupReserve` | ✅ | ⚠️ Partial | Blocked by key mismatch bug; method checks live battery % before setting reserve |
| Set operational mode | `operationalMode` | `setOperationalMode` | ❌ | ❌ Not implemented | — |
| Set energy exports | `energyExports` | `setEnergyExports` | ❌ | ❌ Not implemented | — |
| Set grid charging | `gridCharging` | `setGridCharging` | ❌ | ❌ Not implemented | — |

## Conditions: Powerwall Tab

Conditions are stored in `schedule.conditions` (JSONB array). The scheduler never reads this field — it proceeds straight to action execution on every cron tick regardless of battery state.

Evaluating these conditions would require calling `Fleet.getLiveStatus()` at tick time to get the current `percentage_charged` value.

| Condition (UI Label) | UI Key | Stored in DB | Evaluated at Runtime | Notes |
|---|---|---|---|---|
| Charged up to X% | `charged` | ✅ | ❌ | Guard: run only when battery ≥ X% |
| Discharged down to X% | `discharged` | ✅ | ❌ | Guard: run only when battery ≤ X% |
| Discharged down to backup reserve | `backup` | ✅ | ❌ | Guard: run only when battery ≤ backup reserve level |
| Only between hours (optional) | `betweenHours` | ✅ | ❌ | Time-window guard; stored alongside the charge condition |

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

| Category | Total items | Complete | Partial (bug) | Not implemented |
|---|---|---|---|---|
| Actions | 5 | 0 | 2 | 3 |
| Powerwall conditions | 4 | 0 | 0 | 4 |
| Flow conditions | 9 | 0 | 0 | 9 |
| **Total** | **18** | **0** | **2** | **16** |

No schedule action or condition executes end-to-end today. The highest-leverage first step is fixing the action key mismatch bug, which would immediately unblock the two existing Fleet methods (`setBackupReserve`, `setSoftBackupReserve`) without any further code changes.
