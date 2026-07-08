import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select, { type SelectChangeEvent } from "@mui/material/Select";
import Divider from "@mui/material/Divider";
import type { SxProps, Theme } from "@mui/material/styles";
import type { SiteOption } from "./SiteSingleSelect";

const ALL_SITES = "*";

interface Props {
  sites: SiteOption[];
  value: string[] | "*";
  onChange: (value: string[] | "*") => void;
  label?: string;
  size?: "small" | "medium";
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  disabled?: boolean;
}

// Multi-select for granting a delegate access to a subset of sites, with an
// "All sites" option mapping to the "*" sentinel (present and future sites).
export default function SiteMultiSelect({
  sites,
  value,
  onChange,
  label = "Sites",
  size = "small",
  fullWidth = false,
  sx,
  disabled,
}: Props) {
  const selected = value === ALL_SITES ? [ALL_SITES] : value;

  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const raw = event.target.value;
    const next = typeof raw === "string" ? raw.split(",") : raw;
    if (next.includes(ALL_SITES) && !selected.includes(ALL_SITES)) {
      onChange(ALL_SITES);
      return;
    }
    onChange(next.filter((id) => id !== ALL_SITES));
  };

  return (
    <FormControl size={size} fullWidth={fullWidth} sx={sx} disabled={disabled}>
      <InputLabel id="site-multi-select-label">{label}</InputLabel>
      <Select
        labelId="site-multi-select-label"
        multiple
        value={selected}
        label={label}
        onChange={handleChange}
        renderValue={(selectedIds) =>
          selectedIds.includes(ALL_SITES)
            ? "All sites"
            : sites
                .filter((s) => selectedIds.includes(s.id))
                .map((s) => s.site_name)
                .join(", ")
        }
      >
        <MenuItem value={ALL_SITES}>
          <Checkbox checked={selected.includes(ALL_SITES)} size="small" />
          <ListItemText primary="All sites" />
        </MenuItem>
        <Divider />
        {sites.map((site) => (
          <MenuItem
            key={site.id}
            value={site.id}
            disabled={selected.includes(ALL_SITES)}
          >
            <Checkbox checked={selected.includes(site.id)} size="small" />
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
              <ListItemText primary={site.site_name} />
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
