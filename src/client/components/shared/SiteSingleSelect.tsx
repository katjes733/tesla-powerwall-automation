import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import type { SxProps, Theme } from "@mui/material/styles";

export interface SiteOption {
  id: string;
  site_name: string;
  is_online: boolean;
}

interface Props {
  sites: SiteOption[];
  value: string;
  onChange: (siteId: string) => void;
  label?: string;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  disabled?: boolean;
}

export default function SiteSingleSelect({
  sites,
  value,
  onChange,
  label = "Site",
  size = "small",
  fullWidth = false,
  sx,
  disabled,
}: Props) {
  return (
    <FormControl size={size} fullWidth={fullWidth} sx={sx} disabled={disabled}>
      <InputLabel id="site-single-select-label">{label}</InputLabel>
      <Select
        labelId="site-single-select-label"
        value={value}
        label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        {sites.map((site) => (
          <MenuItem key={site.id} value={site.id}>
            <Box display="flex" alignItems="center" gap={1}>
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: site.is_online ? "success.main" : "action.disabled",
                  flexShrink: 0,
                }}
              />
              {site.site_name}
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
