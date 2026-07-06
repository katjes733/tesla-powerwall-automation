import Box from "@mui/material/Box";
import { ResponsiveContainer } from "recharts";
import type { ReactElement } from "react";

interface TouchSafeChartFrameProps {
  height: number;
  onDoubleClick?: () => void;
  children: ReactElement;
}

// Wraps a Recharts chart so touch-drag (used for the tooltip crosshair and
// drag-to-zoom) doesn't get hijacked by the browser's native horizontal gestures
// (page-level swipe navigation, text selection, iOS's magnifying-glass loupe).
// `data-energy-chart` lets page-level touch handlers detect "this gesture started
// on a chart" and bail out of their own swipe/pull handling.
export default function TouchSafeChartFrame({
  height,
  onDoubleClick,
  children,
}: TouchSafeChartFrameProps) {
  return (
    <Box
      onDoubleClick={onDoubleClick}
      data-energy-chart="true"
      sx={{
        touchAction: "pan-y",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </Box>
  );
}
