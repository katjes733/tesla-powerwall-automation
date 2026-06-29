import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

export interface SummaryItem {
  label: string;
  kwh: number;
  percent: number;
  color: string;
}

interface Props {
  title: string;
  items: SummaryItem[];
}

export default function EnergySummaryCards({ title, items }: Props) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        {items.map((item) => (
          <Paper
            key={item.label}
            variant="outlined"
            sx={{ p: 1.5, minWidth: 110, flex: "1 1 110px" }}
          >
            <Box display="flex" alignItems="center" gap={0.75} mb={0.5}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: item.color,
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {item.label}
              </Typography>
            </Box>
            <Typography variant="body2" fontWeight={600}>
              {item.kwh.toFixed(2)} kWh
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.percent.toFixed(1)}%
            </Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
