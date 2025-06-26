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

export interface SiteInfo {
  id: string;
  site_name: string;
  backup_reserve_percent: number;
  default_real_mode: string;
  installation_date: string;
  user_settings: Record<string, any>;
  app_settings: Record<string, any>;
  components: Record<string, any>;
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
