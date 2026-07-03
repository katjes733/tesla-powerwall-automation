# Grafana Dashboard — Tesla Powerwall Automation

- [Grafana Dashboard — Tesla Powerwall Automation](#grafana-dashboard--tesla-powerwall-automation)
  - [Prerequisites](#prerequisites)
  - [Import](#import)
  - [Post-import: add the Site variable](#post-import-add-the-site-variable)
  - [Panel overview](#panel-overview)
  - [Notes](#notes)

---

## Prerequisites

Before importing, the app must already be deployed from `main` with the `feat/logger` changes merged. That deploy:

- Emits structured JSON logs with `siteName` and `service` in the log body
- Configures the Loki Docker logging driver to extract those fields as native Loki stream labels (via the `LOKI_PIPELINE` block in `deploy.yml`)

Once the container is running and the first scheduler tick or product API call has fired, `siteName` will be available as a Loki label and the Site variable will populate.

---

## Import

1. Open Grafana → **Dashboards** → **Import**
2. Click **Upload dashboard JSON file** and select `tesla-powerwall-automation.json`
3. Confirm the Loki datasource is mapped correctly
4. Click **Import**

The dashboard loads with all panels present. Most will show **No data** until the Site variable is added below.

---

## Post-import: add the Site variable

The Grafana Scenes JSON schema does not support query-type variables in the import format, so the `$site` variable must be added manually once after import.

1. Open the dashboard → **Dashboard settings** (gear icon) → **Variables** → **+ Add variable**
2. Fill in:

   | Field                           | Value                                           |
   | ------------------------------- | ----------------------------------------------- |
   | Type                            | Query                                           |
   | Name                            | `site`                                          |
   | Label                           | `Site`                                          |
   | Query options → Data source     | loki                                            |
   | Query options → Query type      | Label values                                    |
   | Query options → Label           | `siteName`                                      |
   | Query options → Stream selector | `{container_name="tesla-powerwall-automation"}` |
   | Query options → Refresh         | On dashboard load                               |
   | Include All option              | ✓                                               |
   | Custom all value                | `.*`                                            |

3. Click **Preview** — your site name(s) should appear
4. **Apply** → **Save dashboard**

> If Preview is empty, the app has not yet shipped a log with `siteName` since the last deploy. Wait for the first scheduler tick or make any request in the app, then try again.

---

## Panel overview

| Section                | Panels                                                                                  | Notes                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Overview**           | Log volume by level, Error rate by service, Schedule runs/hr, Tesla API retries         | Error rate has no site filter — surfaces startup/db errors before site context is available |
| **Schedule Execution** | Actions over time, Schedule failures, Recent executions                                 | Use `scheduleId` from Recent Executions to drill into a specific run in Grafana Explore     |
| **Smart Charging**     | Grid charging decisions, SOC at decision, Solar forecast, Forecast method, Decision log | Decision log line: `[action] soc= target= \| solar=kWh (method) \| rate=kW \| reason`       |
| **Auth Events**        | Login activity (success/failure/locked), Auth event log                                 | No site filter — auth is user-scoped, not site-scoped                                       |
| **Calibration**        | Calibration events over time, Calibration event log                                     | Requires `eventType=~"calibration_.*"` logs from `service=fleet`                            |
| **System Health**      | All logs, Error logs, DB errors, Mail events                                            | All logs and Error logs respect the site filter; DB/mail panels do not                      |

---

## Notes

- **Datasource name:** all queries reference the datasource by name `loki`. If yours has a different name in Grafana, update it after import in Dashboard settings → Data sources.
- **Timezone:** defaults to `America/Phoenix`. Change in Dashboard settings → Time options.
- **SOC at Decision / Solar Forecast panels** return no data until smart charging schedules have run at least once — they use `unwrap data_soc` and `unwrap data_estimatedSolarKwh` which require numeric fields emitted by the scheduler.
- **Forecast Method donut** uses `$__range` (the full selected time window) for totals — most useful over a 24h+ window.
- **Logs before the `feat/logger` deploy** do not have `siteName` or `service` as Loki labels. Set the time range to **Last 1 hour** right after deploy to confirm the new labels are flowing.
