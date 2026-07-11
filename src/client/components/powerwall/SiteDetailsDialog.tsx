import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import type { Product, SiteInfo } from "~/server/types/common";

interface Props {
  open: boolean;
  onClose: () => void;
  product: Product;
  info: SiteInfo | null;
}

export function modeLabel(mode: string): string {
  const map: Record<string, string> = {
    autonomous: "Self-Powered",
    backup: "Backup Only",
    self_consumption: "Self-Consumption",
  };
  return map[mode] ?? mode;
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        align="right"
        sx={mono ? { fontFamily: "monospace", fontSize: "0.75rem" } : undefined}
      >
        {value}
      </Typography>
    </Box>
  );
}

// Everything about a site that's useful to know but doesn't need to occupy
// permanent space on the card — the card shows only a compact "Site details"
// row that opens this on demand, freeing up room for the energy-flow diagram.
export default function SiteDetailsDialog({
  open,
  onClose,
  product,
  info,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {info?.site_name ?? product.site_name ?? "Site Details"}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <DetailRow label="Site ID" value={product.energy_site_id} mono />
          {product.gateway_id && (
            <DetailRow label="Gateway ID" value={product.gateway_id} mono />
          )}
          {info && (
            <>
              {/* Mode, Backup reserve, and Grid charging are already shown
                  directly on the card's collapsed details row — no need to
                  repeat them here. */}
              <DetailRow label="Batteries" value={info.battery_count} />
              <DetailRow label="Firmware" value={info.version} mono />
              {info.installation_date && (
                <DetailRow
                  label="Installed"
                  value={dayjs(info.installation_date).format("MMM D, YYYY")}
                />
              )}
              {info.installation_time_zone && (
                <DetailRow
                  label="Timezone"
                  value={info.installation_time_zone}
                />
              )}
              {info.utility && (
                <DetailRow label="Utility" value={info.utility} />
              )}
              {info.nameplate_power != null && (
                <DetailRow
                  label="Nameplate power"
                  value={`${(info.nameplate_power / 1000).toFixed(1)} kW`}
                />
              )}
              {info.nameplate_energy != null && (
                <DetailRow
                  label="Nameplate energy"
                  value={`${(info.nameplate_energy / 1000).toFixed(1)} kWh`}
                />
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
