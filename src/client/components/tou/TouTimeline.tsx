import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  PERIOD_COLORS,
  PERIOD_LABELS,
  type TouTimeBlock,
} from "~/shared/types/tou";

interface Props {
  periods: TouTimeBlock[];
  view: "weekday" | "weekend";
}

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const TOTAL_MINUTES = 1440;

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function toPct(minutes: number): number {
  return (minutes / TOTAL_MINUTES) * 100;
}

// Period priority for z-index (higher index = higher priority = on top)
const PRIORITY: Record<string, number> = {
  SUPER_OFF_PEAK: 1,
  OFF_PEAK: 2,
  PARTIAL_PEAK: 3,
  ON_PEAK: 4,
};

export default function TouTimeline({ periods, view }: Props) {
  const filtered = periods.filter((b) =>
    view === "weekday" ? b.toDayOfWeek <= 4 : b.toDayOfWeek >= 5,
  );

  return (
    <Box sx={{ width: "100%" }}>
      {/* Timeline bar */}
      <Box
        sx={{
          position: "relative",
          height: 40,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {filtered.map((block) => {
          const startMin = toMinutes(block.fromHour, block.fromMinute);
          const endMin = toMinutes(block.toHour, block.toMinute);
          const wraps = endMin <= startMin;

          const renderSegment = (from: number, to: number) => {
            const left = toPct(from);
            const width = toPct(to - from);
            if (width <= 0) return null;
            const label = `${PERIOD_LABELS[block.type]} ${String(block.fromHour).padStart(2, "0")}:${String(block.fromMinute).padStart(2, "0")}–${String(block.toHour).padStart(2, "0")}:${String(block.toMinute).padStart(2, "0")}`;
            return (
              <Tooltip
                key={`${block.id}-${from}`}
                title={label}
                placement="top"
              >
                <Box
                  sx={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 0,
                    bottom: 0,
                    bgcolor: PERIOD_COLORS[block.type],
                    opacity: 0.85,
                    zIndex: PRIORITY[block.type] ?? 1,
                  }}
                />
              </Tooltip>
            );
          };

          if (wraps) {
            return [
              renderSegment(0, endMin),
              renderSegment(startMin, TOTAL_MINUTES),
            ];
          }
          return renderSegment(startMin, endMin);
        })}
      </Box>

      {/* Hour tick marks */}
      <Box sx={{ position: "relative", height: 16, mt: 0.25 }}>
        {HOUR_LABELS.map((h) => (
          <Box
            key={h}
            sx={{
              position: "absolute",
              left: `${toPct(h * 60)}%`,
              transform: "translateX(-50%)",
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: 9 }}
            >
              {h === 0 || h === 24
                ? "12a"
                : h < 12
                  ? `${h}a`
                  : h === 12
                    ? "12p"
                    : `${h - 12}p`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
