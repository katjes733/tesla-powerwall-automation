export interface TokenData {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  state: string;
  token_type: string;
}

export interface JWT {
  exp: number;
}

export interface RefreshTokenData {
  id: string;
  email: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface Product {
  id: string;
  site_name: string;
  device_type: string;
  energy_site_id: number;
  gateway_id: string;
}

export interface UserSettings {
  [key: string]: unknown;
}

export interface Gateway {
  device_id: string;
  part_name?: string;
  is_active: boolean;
  leader_device_id?: string;
  // PW3 lead gateway reports total system capacity in Wh; absent/0 on non-lead units.
  nameplate_energy_watts?: number;
}

export interface Battery {
  device_id: string;
  part_name?: string; // "Powerwall 2" | "Unknown" (expansion) | undefined
  is_active: boolean;
  // PW2 batteries report their individual capacity in Wh; always 0 on PW3 expansion packs.
  nameplate_energy?: number;
}

export interface SiteComponents {
  disallow_charge_from_grid_with_solar_installed?: boolean;
  customer_preferred_export_rule?: string; // "pv_only" | "battery_ok"
  gateways?: Gateway[];
  batteries?: Battery[];
  [key: string]: unknown;
}

export interface TouPeriod {
  fromDayOfWeek: number;
  toDayOfWeek: number;
  fromHour: number;
  toHour: number;
  fromMinute: number;
  toMinute: number;
}

export interface TariffSeason {
  fromDay: number;
  fromMonth: number;
  toDay: number;
  toMonth: number;
  tou_periods: {
    // Tesla API returns uppercase keys (ON_PEAK); lowercase kept for compat.
    on_peak?: TouPeriod[];
    ON_PEAK?: TouPeriod[];
    [key: string]: TouPeriod[] | undefined;
  };
}

export interface TariffContent {
  // Tesla API returns seasons directly at the top level of tariff_content.
  seasons?: Record<string, TariffSeason>;
  // Some firmware versions nest seasons under utility_rates; support both.
  utility_rates?: {
    seasons?: Record<string, TariffSeason>;
  };
}

export interface SolarPowerDataPoint {
  timestamp: string; // ISO 8601
  solar_power: number; // Watts
}

export interface SmartChargingActionConfig {
  targetSoc: number;
  solarEfficiencyFactor?: number; // defaults to 0.5; not exposed in UI
}

export interface SiteInfo {
  id: string;
  site_name: string;
  backup_reserve_percent: number;
  default_real_mode: string;
  installation_date: string;
  user_settings: UserSettings;
  app_settings: Record<string, any>;
  components: SiteComponents;
  version: string;
  battery_count: number;
  tariff_content: Record<string, any>;
  nameplate_power: number;
  nameplate_energy: number;
  installation_time_zone: string;
  off_grid_vehicle_charging_reserve_percent: number;
  max_site_meter_power_ac: number;
  min_site_meter_power_ac: number;
  tariff_content_v2: Record<string, any>;
  vpp_backup_reserve_percent: number;
  utility: string;
  island_config: Record<string, any>;
}

export interface LiveStatus {
  solar_power: number;
  percentage_charged: number;
  battery_power: number;
  load_power: number;
  grid_status: string;
  grid_power: number;
  generation_power: number;
  wall_connectors: Record<string, any>;
  island_status: string;
  storm_mode_active: boolean;
}

export interface LoginResponse {
  token: string;
}

export interface SystemStatusResponse {
  nominal_energy_remaining: number;
  nominal_full_pack_energy: number;
}

export interface IBasicEntity {
  id: string;
  creation_time: Date;
  modified_time: Date;
}

export interface FleetOptions {
  mailOnError: boolean;
  throwOnError: boolean;
}

export type FleetOptionsInput = Partial<FleetOptions>;
