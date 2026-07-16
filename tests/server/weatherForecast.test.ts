import { describe, it, expect, vi, beforeEach } from "vitest";
import moment from "moment-timezone";

const { mockFetchWeatherApi } = vi.hoisted(() => ({
  mockFetchWeatherApi: vi.fn(),
}));

vi.mock("openmeteo", () => ({
  fetchWeatherApi: mockFetchWeatherApi,
}));

import {
  fetchRadiationForecast,
  fetchHistoricalRadiation,
  computeRadiationRatio,
  type RadiationPoint,
} from "~/server/util/weatherForecast";

const TZ = "America/Denver";

// Builds a fake WeatherApiResponse — matches the subset of the flatbuffers
// SDK's shape this codebase actually reads (utcOffsetSeconds, hourly().time/
// timeEnd/interval/variables(0).valuesArray()).
function makeFakeResponse(opts: {
  timeStartSec: number;
  intervalSec: number;
  values: number[];
  utcOffsetSeconds?: number;
}) {
  const timeEndSec = opts.timeStartSec + opts.intervalSec * opts.values.length;
  return {
    utcOffsetSeconds: () => opts.utcOffsetSeconds ?? 0,
    hourly: () => ({
      time: () => BigInt(opts.timeStartSec),
      timeEnd: () => BigInt(timeEndSec),
      interval: () => opts.intervalSec,
      variables: (index: number) =>
        index === 0
          ? { valuesArray: () => Float32Array.from(opts.values) }
          : null,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRadiationForecast", () => {
  it("calls the forecast endpoint and parses hourly points", async () => {
    const timeStartSec = Math.floor(
      moment.tz("2026-07-15 00:00", TZ).valueOf() / 1000,
    );
    mockFetchWeatherApi.mockResolvedValueOnce([
      makeFakeResponse({ timeStartSec, intervalSec: 3600, values: [1, 2, 3] }),
    ]);

    const points = await fetchRadiationForecast(33.45, -112.07, TZ);

    expect(mockFetchWeatherApi).toHaveBeenCalledWith(
      "https://api.open-meteo.com/v1/forecast",
      expect.objectContaining({
        latitude: 33.45,
        longitude: -112.07,
        timezone: TZ,
        forecast_days: 2,
        hourly: ["shortwave_radiation"],
      }),
    );
    expect(points).toHaveLength(3);
    expect(points![0].radiation).toBe(1);
    expect(points![0].time.getTime()).toBe(timeStartSec * 1000);
    expect(points![1].time.getTime()).toBe((timeStartSec + 3600) * 1000);
  });

  it("returns null when the API call throws", async () => {
    mockFetchWeatherApi.mockRejectedValueOnce(new Error("network down"));
    const points = await fetchRadiationForecast(33.45, -112.07, TZ);
    expect(points).toBeNull();
  });

  it("returns null when the response has no hourly data", async () => {
    mockFetchWeatherApi.mockResolvedValueOnce([
      { hourly: () => null, utcOffsetSeconds: () => 0 },
    ]);
    const points = await fetchRadiationForecast(33.45, -112.07, TZ);
    expect(points).toBeNull();
  });
});

describe("fetchHistoricalRadiation", () => {
  it("calls the archive endpoint with a trailing date range ending yesterday", async () => {
    mockFetchWeatherApi.mockResolvedValueOnce([
      makeFakeResponse({ timeStartSec: 0, intervalSec: 3600, values: [5] }),
    ]);

    await fetchHistoricalRadiation(33.45, -112.07, TZ, 7);

    const [url, params] = mockFetchWeatherApi.mock.calls[0];
    expect(url).toBe("https://archive-api.open-meteo.com/v1/archive");
    expect(params.latitude).toBe(33.45);
    expect(params.longitude).toBe(-112.07);
    expect(params.hourly).toEqual(["shortwave_radiation"]);
    // 7-day trailing window ending yesterday — exact dates aren't asserted
    // here (they depend on "today"), just that both bounds are present and
    // start is before end.
    expect(params.start_date < params.end_date).toBe(true);
  });
});

describe("computeRadiationRatio", () => {
  const now = moment.tz("2026-07-15 12:00", TZ);
  const deadline = moment.tz("2026-07-15 13:00", TZ);

  function point(isoLocal: string, radiation: number): RadiationPoint {
    return { time: moment.tz(isoLocal, TZ).toDate(), radiation };
  }

  it("returns null when forecast or historical points are empty", () => {
    expect(
      computeRadiationRatio(
        [],
        [point("2026-07-14 12:30", 5)],
        now,
        deadline,
        TZ,
      ),
    ).toBeNull();
    expect(
      computeRadiationRatio(
        [point("2026-07-15 12:30", 5)],
        [],
        now,
        deadline,
        TZ,
      ),
    ).toBeNull();
  });

  it("clamps at 1.0 when the forecast is better than the historical average", () => {
    const forecast = [point("2026-07-15 12:30", 100)];
    const historical = [
      point("2026-07-14 12:30", 50),
      point("2026-07-13 12:30", 50),
    ];
    expect(computeRadiationRatio(forecast, historical, now, deadline, TZ)).toBe(
      1,
    );
  });

  it("reflects a worse-than-average forecast (cloudy today, sunny history)", () => {
    const forecast = [point("2026-07-15 12:30", 20)];
    const historical = [
      point("2026-07-14 12:30", 100),
      point("2026-07-13 12:30", 100),
    ];
    // 20 / 100 = 0.2
    expect(
      computeRadiationRatio(forecast, historical, now, deadline, TZ),
    ).toBeCloseTo(0.2, 5);
  });

  it("averages multiple historical days for the same clock window", () => {
    const forecast = [point("2026-07-15 12:30", 60)];
    const historical = [
      point("2026-07-14 12:30", 100),
      point("2026-07-13 12:30", 50),
    ];
    // avg historical = 75; 60/75 = 0.8
    expect(
      computeRadiationRatio(forecast, historical, now, deadline, TZ),
    ).toBeCloseTo(0.8, 5);
  });

  it("ignores forecast/historical points outside the [now, deadline] clock window", () => {
    const forecast = [
      point("2026-07-15 12:30", 60), // in window
      point("2026-07-15 18:00", 999), // outside window — must be ignored
    ];
    const historical = [
      point("2026-07-14 12:30", 100), // in window
      point("2026-07-14 18:00", 1), // outside window — must be ignored
    ];
    expect(
      computeRadiationRatio(forecast, historical, now, deadline, TZ),
    ).toBeCloseTo(0.6, 5);
  });

  it("returns null when no historical points fall within the clock window", () => {
    const forecast = [point("2026-07-15 12:30", 60)];
    const historical = [point("2026-07-14 18:00", 100)];
    expect(
      computeRadiationRatio(forecast, historical, now, deadline, TZ),
    ).toBeNull();
  });
});
