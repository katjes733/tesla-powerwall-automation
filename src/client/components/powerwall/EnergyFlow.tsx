import { useTheme } from "@mui/material/styles";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import ElectricalServicesIcon from "@mui/icons-material/ElectricalServices";
import HomeIcon from "@mui/icons-material/Home";
import WbSunnyIcon from "@mui/icons-material/WbSunny";

// ─── Animation style toggle ───────────────────────────────────────────────────
// "dash"  = animated dashed stroke-dashoffset
// "pulse" = a glowing spotlight travels source → hub → destination(s),
//           splitting simultaneously when the source has multiple destinations.
type AnimStyle = "dash" | "pulse";
const ANIM_STYLE: AnimStyle = "pulse";
// ─────────────────────────────────────────────────────────────────────────────

// Hub-and-spoke layout (viewBox 0 0 280 320):
//          Solar (140, 55)
//               |
// Grid (40,155)--[Hub(140,155)]--Home(240,155)
//               |
//          Battery (140,255)

interface EnergyFlowProps {
  solar: number;
  grid: number; // positive = importing, negative = exporting
  battery: number; // positive = discharging, negative = charging
  home: number;
  batteryPct: number;
  batteryCount: number;
  connected: boolean;
}

function kw(watts: number): string {
  return `${(Math.abs(watts) / 1000).toFixed(1)} kW`;
}

// PathDef encodes a straight axis-aligned segment.
// a1 < a2 always; `reverse` on each usage indicates actual flow direction.
interface PathDef {
  d: string;
  axis: "h" | "v";
  a1: number; // smaller coordinate along the active axis
  a2: number; // larger coordinate along the active axis
  ac: number; // fixed coordinate on the perpendicular axis
}

// Solar (140,55) r=22 bottom=77 → Hub (140,155) r=8 top=147
const PATH_SOLAR: PathDef = {
  d: "M140,77 L140,147",
  axis: "v",
  a1: 77,
  a2: 147,
  ac: 140,
};
// Grid (40,155) r=22 right=62 → Hub left=132
const PATH_GRID: PathDef = {
  d: "M62,155 L132,155",
  axis: "h",
  a1: 62,
  a2: 132,
  ac: 155,
};
// Hub right=148 → Home (240,155) r=22 left=218
const PATH_HOME: PathDef = {
  d: "M148,155 L218,155",
  axis: "h",
  a1: 148,
  a2: 218,
  ac: 155,
};
// Hub bottom=163 → Battery (140,255) r=22 top=233
const PATH_BATTERY: PathDef = {
  d: "M140,163 L140,233",
  axis: "v",
  a1: 163,
  a2: 233,
  ac: 140,
};

// ── Dash mode ─────────────────────────────────────────────────────────────────

interface FlowLineProps {
  path: PathDef;
  watts: number;
  strokeRef: string; // hex or "url(#id)"
  reverse?: boolean;
}

function FlowLine({ path, watts, strokeRef, reverse = false }: FlowLineProps) {
  if (Math.abs(watts) < 50) return null;
  const dur = Math.max(1.5, 3.5 - (Math.abs(watts) / 15000) * 2);
  const period = 20;
  return (
    <path
      d={path.d}
      fill="none"
      stroke={strokeRef}
      strokeWidth={3.5}
      strokeDasharray="12 8"
      strokeLinecap="round"
      opacity={0.85}
    >
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to={String(reverse ? period : -period)}
        dur={`${dur}s`}
        repeatCount="indefinite"
        calcMode="linear"
      />
    </path>
  );
}

// ── Pulse mode ────────────────────────────────────────────────────────────────
// Routes are grouped by source so each physical segment carries exactly one
// pulse at a time. A source pulse travels to the hub, then all destinations
// animate simultaneously in the second half of the same dur cycle.
//
//   Source segment (segIndex=0):      active t=[0, 0.5], parked t=[0.5, 1]
//   Destination segment (segIndex=1): parked t=[0, 0.5], active t=[0.5, 1]
//
// "Parked" = gradient displaced 2× pathLen off-screen → fully transparent.
// All segments are 70 px so tSplit is always exactly 0.5.

interface RouteSegment {
  path: PathDef;
  reverse: boolean;
}

interface DestSpec {
  seg: RouteSegment;
  key: string; // unique within a source's dsts
}

interface GroupedRoute {
  key: string; // unique source identifier
  src: RouteSegment;
  dsts: DestSpec[];
  watts: number; // total source watts → controls pulse speed
  color: string;
}

function SegmentPulse({
  seg,
  segIndex,
  gradId,
  color,
  dur,
}: {
  seg: RouteSegment;
  segIndex: 0 | 1;
  gradId: string;
  color: string;
  dur: number;
}) {
  const { path, reverse } = seg;
  // All segments are 70 px → gradLen = 140, half = 70
  const half = path.a2 - path.a1; // = 70

  const fromCoord = reverse ? path.a2 : path.a1;
  const toCoord = reverse ? path.a1 : path.a2;
  const step = toCoord - fromCoord; // ±70

  // Gradient-center positions at each of the three keyframes
  const cPre = fromCoord - step * 2; // parked before segment
  const cStart = fromCoord; // pulse at segment entry
  const cEnd = toCoord; // pulse at segment exit (hub edge)
  const cPost = toCoord + step * 2; // parked after segment

  // Segment 0: [start, end, post] at keyTimes [0, 0.5, 1]
  // Segment 1: [pre, start, end]  at keyTimes [0, 0.5, 1]
  const g1 =
    segIndex === 0
      ? [cStart - half, cEnd - half, cPost - half]
      : [cPre - half, cStart - half, cEnd - half];
  const g2 =
    segIndex === 0
      ? [cStart + half, cEnd + half, cPost + half]
      : [cPre + half, cStart + half, cEnd + half];

  const isH = path.axis === "h";

  const x1 = isH ? g1[0] : path.ac;
  const y1 = isH ? path.ac : g1[0];
  const x2 = isH ? g2[0] : path.ac;
  const y2 = isH ? path.ac : g2[0];

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
        >
          <stop offset="0%" stopColor={color} stopOpacity={0} />
          <stop offset="40%" stopColor={color} stopOpacity={0} />
          <stop offset="50%" stopColor={color} stopOpacity={1} />
          <stop offset="60%" stopColor={color} stopOpacity={0} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
          <animate
            attributeName={isH ? "x1" : "y1"}
            values={g1.join(";")}
            keyTimes="0;0.5;1"
            dur={`${dur}s`}
            repeatCount="indefinite"
            calcMode="linear"
          />
          <animate
            attributeName={isH ? "x2" : "y2"}
            values={g2.join(";")}
            keyTimes="0;0.5;1"
            dur={`${dur}s`}
            repeatCount="indefinite"
            calcMode="linear"
          />
        </linearGradient>
      </defs>
      {/* Glow halo */}
      <path
        d={path.d}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={10}
        strokeLinecap="round"
        opacity={0.3}
      />
      {/* Bright core */}
      <path
        d={path.d}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
    </>
  );
}

// One source pulse fans out to all destinations simultaneously.
function FlowSourcePulse({ route }: { route: GroupedRoute }) {
  if (route.watts < 50) return null;
  const dur = Math.max(1.5, 3.5 - (route.watts / 15000) * 2);
  return (
    <>
      <SegmentPulse
        seg={route.src}
        segIndex={0}
        gradId={`pulse-${route.key}-src`}
        color={route.color}
        dur={dur}
      />
      {route.dsts.map((dst) => (
        <SegmentPulse
          key={dst.key}
          seg={dst.seg}
          segIndex={1}
          gradId={`pulse-${route.key}-dst-${dst.key}`}
          color={route.color}
          dur={dur}
        />
      ))}
    </>
  );
}

// ── Node ──────────────────────────────────────────────────────────────────────

interface NodeProps {
  cx: number;
  cy: number;
  r: number;
  color: string;
  icon: React.ReactNode;
  iconSize: number;
  label: string;
  value: string;
  valueLine2?: string;
  labelAbove?: boolean;
  connected: boolean;
}

function Node({
  cx,
  cy,
  r,
  color,
  icon,
  iconSize,
  label,
  value,
  valueLine2,
  labelAbove = false,
  connected,
}: NodeProps) {
  const theme = useTheme();
  const strokeColor = connected ? color : theme.palette.action.disabled;
  const textColor = connected
    ? theme.palette.text.primary
    : theme.palette.text.disabled;
  const captionColor = connected
    ? theme.palette.text.secondary
    : theme.palette.text.disabled;

  const gap = labelAbove ? 8 : 13;
  const lineH = 14;
  const valueY = labelAbove ? cy - r - gap : cy + r + gap + lineH;
  const labelY = labelAbove ? cy - r - gap - lineH : cy + r + gap;
  const value2Y = labelAbove
    ? cy - r - gap - 2 * lineH
    : cy + r + gap + 2 * lineH;

  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={theme.palette.background.paper}
        stroke={strokeColor}
        strokeWidth={2}
      />
      <foreignObject
        x={cx - iconSize / 2}
        y={cy - iconSize / 2}
        width={iconSize}
        height={iconSize}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: strokeColor,
            width: "100%",
            height: "100%",
          }}
        >
          {icon}
        </div>
      </foreignObject>
      <text
        x={cx}
        y={valueY}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={textColor}
        fontFamily="inherit"
      >
        {value}
      </text>
      <text
        x={cx}
        y={labelY}
        textAnchor="middle"
        fontSize={10}
        fill={captionColor}
        fontFamily="inherit"
        letterSpacing={0.5}
      >
        {label}
      </text>
      {valueLine2 && (
        <text
          x={cx}
          y={value2Y}
          textAnchor="middle"
          fontSize={10}
          fill={captionColor}
          fontFamily="inherit"
        >
          {valueLine2}
        </text>
      )}
    </g>
  );
}

interface GradStop {
  stopColor: string;
  offset: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EnergyFlow({
  solar,
  grid,
  battery,
  home,
  batteryPct,
  batteryCount,
  connected,
}: EnergyFlowProps) {
  const theme = useTheme();

  const solarColor = "#f59e0b";
  const gridColor = theme.palette.secondary.main;
  const homeColor = theme.palette.text.secondary;
  const batteryColor = theme.palette.primary.main;
  const trackColor = theme.palette.divider;

  const solarIn = Math.max(solar, 0);
  const gridIn = Math.max(grid, 0);
  const battDischIn = Math.max(battery, 0);
  const totalIn = solarIn + gridIn + battDischIn;
  const battChargeOut = Math.max(-battery, 0);
  const gridExpOut = Math.max(-grid, 0);

  const solarActive = solarIn >= 50;
  const gridImporting = gridIn >= 50;
  const gridExporting = gridExpOut >= 50;
  const battDischarging = battDischIn >= 100;
  const battCharging = battChargeOut >= 100;
  const homeActive = home >= 50;

  // Proportional source fractions
  const homeSolarFrac = totalIn > 0 ? solarIn / totalIn : 0;
  const homeGridFrac = totalIn > 0 ? gridIn / totalIn : 0;
  const homeBattFrac = totalIn > 0 ? battDischIn / totalIn : 0;

  // Battery charging attribution: solar fills first, grid covers remainder
  const battSolarIn = Math.min(solarIn, battChargeOut);
  const battGridIn = Math.max(0, battChargeOut - battSolarIn);
  const battTotalIn = battSolarIn + battGridIn;
  const battSolarFrac = battTotalIn > 0 ? battSolarIn / battTotalIn : 0;

  // ── Dash mode: proportional colour gradients on outgoing lines ──────────────
  const homeActiveSrcCount = [homeSolarFrac, homeBattFrac, homeGridFrac].filter(
    (f) => f > 0.05,
  ).length;
  const useHomeGrad = homeActive && homeActiveSrcCount > 1;
  const useBattGrad =
    battCharging && battSolarFrac > 0.05 && battSolarFrac < 0.95;

  const homeGradStops: GradStop[] = [];
  if (useHomeGrad) {
    let off = 0;
    const segs = [
      { frac: homeSolarFrac, color: solarColor },
      { frac: homeBattFrac, color: batteryColor },
      { frac: homeGridFrac, color: gridColor },
    ].filter((s) => s.frac > 0.05);
    for (const seg of segs) {
      homeGradStops.push({
        offset: `${Math.round(off * 100)}%`,
        stopColor: seg.color,
      });
      off += seg.frac;
      homeGradStops.push({
        offset: `${Math.round(off * 100)}%`,
        stopColor: seg.color,
      });
    }
  }

  const homeStroke = useHomeGrad
    ? "url(#grad-home)"
    : homeSolarFrac >= 0.5
      ? solarColor
      : homeGridFrac >= 0.5
        ? gridColor
        : homeBattFrac >= 0.5
          ? batteryColor
          : homeColor;

  const battChargeStroke = useBattGrad
    ? "url(#grad-batt)"
    : battSolarFrac >= 0.5
      ? solarColor
      : gridColor;

  // ── Pulse mode: one grouped route per source ───────────────────────────────
  // Each source gets exactly ONE animation on its incoming segment (no doubles),
  // and all destinations fan out simultaneously in the second half of the cycle.
  const groupedRoutes: GroupedRoute[] = [];
  if (connected && ANIM_STYLE === "pulse") {
    const solarToHomeW = homeSolarFrac * home;
    const gridToHomeW = homeGridFrac * home;
    const battToHomeW = homeBattFrac * home;

    // Solar: can feed battery, home, and/or grid export
    if (solarActive) {
      const solarDsts: DestSpec[] = [];
      if (battSolarIn >= 50)
        solarDsts.push({
          seg: { path: PATH_BATTERY, reverse: false },
          key: "batt",
        });
      if (solarToHomeW >= 50)
        solarDsts.push({
          seg: { path: PATH_HOME, reverse: false },
          key: "home",
        });
      if (gridExporting)
        solarDsts.push({
          seg: { path: PATH_GRID, reverse: true },
          key: "gridexp",
        });
      if (solarDsts.length > 0)
        groupedRoutes.push({
          key: "solar",
          src: { path: PATH_SOLAR, reverse: false },
          dsts: solarDsts,
          watts: solarIn,
          color: solarColor,
        });
    }

    // Grid import: can feed battery and/or home
    if (gridImporting) {
      const gridDsts: DestSpec[] = [];
      if (battGridIn >= 50)
        gridDsts.push({
          seg: { path: PATH_BATTERY, reverse: false },
          key: "batt",
        });
      if (gridToHomeW >= 50)
        gridDsts.push({
          seg: { path: PATH_HOME, reverse: false },
          key: "home",
        });
      if (gridDsts.length > 0)
        groupedRoutes.push({
          key: "grid",
          src: { path: PATH_GRID, reverse: false },
          dsts: gridDsts,
          watts: gridIn,
          color: gridColor,
        });
    }

    // Battery discharge: can feed home and/or grid export (when solar not exporting)
    if (battDischarging) {
      const battDsts: DestSpec[] = [];
      if (battToHomeW >= 50)
        battDsts.push({
          seg: { path: PATH_HOME, reverse: false },
          key: "home",
        });
      if (gridExporting && !solarActive)
        battDsts.push({
          seg: { path: PATH_GRID, reverse: true },
          key: "gridexp",
        });
      if (battDsts.length > 0)
        groupedRoutes.push({
          key: "batt",
          src: { path: PATH_BATTERY, reverse: true },
          dsts: battDsts,
          watts: battDischIn,
          color: batteryColor,
        });
    }
  }

  return (
    <svg
      viewBox="0 0 280 320"
      width="100%"
      style={{ maxHeight: 320, display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Dash mode: proportional-source gradients for outgoing lines */}
      {useHomeGrad && homeGradStops.length > 0 && (
        <defs>
          <linearGradient
            id="grad-home"
            gradientUnits="userSpaceOnUse"
            x1="148"
            y1="155"
            x2="218"
            y2="155"
          >
            {homeGradStops.map((s, i) => (
              <stop key={i} offset={s.offset} stopColor={s.stopColor} />
            ))}
          </linearGradient>
        </defs>
      )}
      {useBattGrad && (
        <defs>
          <linearGradient
            id="grad-batt"
            gradientUnits="userSpaceOnUse"
            x1="140"
            y1="163"
            x2="140"
            y2="233"
          >
            <stop offset="0%" stopColor={solarColor} />
            <stop
              offset={`${Math.round(battSolarFrac * 100)}%`}
              stopColor={solarColor}
            />
            <stop
              offset={`${Math.round(battSolarFrac * 100)}%`}
              stopColor={gridColor}
            />
            <stop offset="100%" stopColor={gridColor} />
          </linearGradient>
        </defs>
      )}

      {/* Static track lines */}
      <line
        x1={140}
        y1={77}
        x2={140}
        y2={147}
        stroke={trackColor}
        strokeWidth={2}
      />
      <line
        x1={62}
        y1={155}
        x2={132}
        y2={155}
        stroke={trackColor}
        strokeWidth={2}
      />
      <line
        x1={148}
        y1={155}
        x2={218}
        y2={155}
        stroke={trackColor}
        strokeWidth={2}
      />
      <line
        x1={140}
        y1={163}
        x2={140}
        y2={233}
        stroke={trackColor}
        strokeWidth={2}
      />

      {/* Dash mode: independent animated segment per active flow */}
      {connected && ANIM_STYLE === "dash" && (
        <>
          {solarActive && (
            <FlowLine
              path={PATH_SOLAR}
              watts={solarIn}
              strokeRef={solarColor}
            />
          )}
          {gridImporting && (
            <FlowLine path={PATH_GRID} watts={gridIn} strokeRef={gridColor} />
          )}
          {gridExporting && (
            <FlowLine
              path={PATH_GRID}
              watts={gridExpOut}
              strokeRef={solarActive ? solarColor : batteryColor}
              reverse
            />
          )}
          {homeActive && (
            <FlowLine path={PATH_HOME} watts={home} strokeRef={homeStroke} />
          )}
          {battCharging && (
            <FlowLine
              path={PATH_BATTERY}
              watts={battChargeOut}
              strokeRef={battChargeStroke}
            />
          )}
          {battDischarging && (
            <FlowLine
              path={PATH_BATTERY}
              watts={battDischIn}
              strokeRef={batteryColor}
              reverse
            />
          )}
        </>
      )}

      {/* Pulse mode: one source per route, destinations fire simultaneously */}
      {groupedRoutes.map((route) => (
        <FlowSourcePulse key={route.key} route={route} />
      ))}

      {/* Hub — rendered over lines so endpoints are clean */}
      <circle
        cx={140}
        cy={155}
        r={8}
        fill={theme.palette.background.paper}
        stroke={trackColor}
        strokeWidth={2}
      />

      {/* Energy nodes */}
      <Node
        cx={140}
        cy={55}
        r={22}
        color={solarColor}
        icon={<WbSunnyIcon style={{ fontSize: 18 }} />}
        iconSize={18}
        label="SOLAR"
        value={connected ? kw(solar) : "–"}
        labelAbove
        connected={connected}
      />
      <Node
        cx={40}
        cy={155}
        r={22}
        color={gridColor}
        icon={<ElectricalServicesIcon style={{ fontSize: 18 }} />}
        iconSize={18}
        label="GRID"
        value={connected ? kw(grid) : "–"}
        connected={connected}
      />
      <Node
        cx={240}
        cy={155}
        r={22}
        color={homeColor}
        icon={<HomeIcon style={{ fontSize: 18 }} />}
        iconSize={18}
        label="HOME"
        value={connected ? kw(home) : "–"}
        connected={connected}
      />
      <Node
        cx={140}
        cy={255}
        r={22}
        color={batteryColor}
        icon={<BatteryChargingFullIcon style={{ fontSize: 18 }} />}
        iconSize={18}
        label="BATTERY"
        value={connected ? kw(battery) : "–"}
        valueLine2={
          connected && batteryCount > 0
            ? `${Math.round(batteryPct)}% · ${batteryCount}x`
            : undefined
        }
        connected={connected}
      />
    </svg>
  );
}
