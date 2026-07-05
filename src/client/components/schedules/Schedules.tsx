import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useAuth } from "../auth/AuthContext";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import axios from "axios";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TextField from "@mui/material/TextField";
import { alpha, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import BatteryFullIcon from "@mui/icons-material/BatteryFull";
import SettingsIcon from "@mui/icons-material/Settings";
import BoltIcon from "@mui/icons-material/Bolt";
import PowerIcon from "@mui/icons-material/Power";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Avatar from "@mui/material/Avatar";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { IconButton } from "@mui/material";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import OutlinedInput from "@mui/material/OutlinedInput";
import Slider from "@mui/material/Slider";
import AddIcon from "@mui/icons-material/Add";
import { useNotification } from "../notification/NotificationContext";
import { v4 as uuidv4 } from "uuid";
import Badge from "@mui/material/Badge";
import CheckIcon from "@mui/icons-material/Check";
import Alert from "@mui/material/Alert";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import dayjs, { type Dayjs } from "dayjs";
import ScienceIcon from "@mui/icons-material/Science";
import ShowChartIcon from "@mui/icons-material/ShowChart";

type HolidayEntry = {
  name: string;
  date: string;
  observance: "auto" | "none";
  source: string;
  enabled: boolean;
};

type SiteWithTimezone = {
  id: string;
  site_name: string;
  is_online: boolean;
  timezone?: string;
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DOW_NAMES: Record<string, string> = {
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
};

const ORDINAL_LABELS: Record<string, string> = {
  "1st": "1st",
  "2nd": "2nd",
  "3rd": "3rd",
  "4th": "4th",
  last: "last",
};

function formatHolidayDate(date: string): string {
  if (/^\d{2}-\d{2}$/.test(date)) {
    const [mm, dd] = date.split("-").map(Number);
    return `${MONTH_NAMES[mm - 1]} ${dd}`;
  }
  const m = /^(1st|2nd|3rd|4th|last)(Mon|Tue|Wed|Thu|Fri)(\d{2})$/.exec(date);
  if (m) {
    const [, ord, dow, mm] = m;
    return `${ORDINAL_LABELS[ord]} ${DOW_NAMES[dow]} in ${MONTH_NAMES[parseInt(mm, 10) - 1]}`;
  }
  return date;
}

const HOLIDAY_SOURCES = [
  { value: "US_MAJOR", label: "US Major Utility Holidays" },
  { value: "US_FEDERAL_ALL", label: "US All Federal Holidays" },
  { value: "CA_FEDERAL", label: "Canada Federal Holidays" },
  { value: "CUSTOM", label: "Custom" },
];

function generateHolidayTemplates(source: string): HolidayEntry[] {
  switch (source) {
    case "US_MAJOR":
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Memorial Day",
          date: "lastMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Independence Day",
          date: "07-04",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Labor Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "4thThu11",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    case "US_FEDERAL_ALL":
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Martin Luther King Jr. Day",
          date: "3rdMon01",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Presidents' Day",
          date: "3rdMon02",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Memorial Day",
          date: "lastMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Juneteenth National Independence Day",
          date: "06-19",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Independence Day",
          date: "07-04",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Labor Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Columbus Day",
          date: "2ndMon10",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Veterans Day",
          date: "11-11",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "4thThu11",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    case "CA_FEDERAL":
      return [
        {
          name: "New Year's Day",
          date: "01-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Victoria Day",
          date: "3rdMon05",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Canada Day",
          date: "07-01",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Civic Holiday",
          date: "1stMon08",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Labour Day",
          date: "1stMon09",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "National Day for Truth and Reconciliation",
          date: "09-30",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Thanksgiving Day",
          date: "2ndMon10",
          observance: "none",
          source,
          enabled: true,
        },
        {
          name: "Remembrance Day",
          date: "11-11",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Christmas Day",
          date: "12-25",
          observance: "auto",
          source,
          enabled: true,
        },
        {
          name: "Boxing Day",
          date: "12-26",
          observance: "auto",
          source,
          enabled: true,
        },
      ];
    default:
      return [];
  }
}

type SettingsProps = {
  schedule: any;
  setSchedule: (row: any) => void;
  setTabValid: (valid: boolean) => void;
};

function parseCronToTimeAndDays(cron: string) {
  if (cron === "* * * * *") {
    return { time: "", days: [] };
  }
  const [minute, hour, , , dayOfWeek] = cron.split(" ");
  const pad = (n: string) => (n.length === 1 ? `0${n}` : n);
  const time = `${pad(hour)}:${pad(minute)}`;
  let days: string[] = [];
  if (dayOfWeek === "*") {
    days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  } else if (/^[0-6](-[0-6])?$/.test(dayOfWeek)) {
    // e.g. 1-5 for weekdays
    const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    if (dayOfWeek.includes("-")) {
      const [start, end] = dayOfWeek.split("-").map(Number);
      days = map.slice(start, end + 1);
    } else {
      days = [map[Number(dayOfWeek)]];
    }
  } else {
    // comma separated days
    const map = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    days = dayOfWeek.split(",").map((d) => map[Number(d)]);
  }
  return { time, days };
}

function parseTimeAndDaysToCron(time: string, days: string[]) {
  if (!Array.isArray(days) || days.length === 0 || !time) {
    return null;
  }
  const [hour, minute] = time.split(":");
  const dayOfWeek = days
    .map((d) =>
      String(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(d)),
    )
    .join(",");
  return `${minute} ${hour} * * ${dayOfWeek}`;
}

function isFixedTime(cron: string) {
  const [minute, hour] = cron.split(" ");
  return /^\d+$/.test(minute) && /^\d+$/.test(hour);
}

function humanizeDays(days: string[]): string {
  if (days.length === 7) return "every day";
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const weekend = ["Sat", "Sun"];
  if (
    days.length === 5 &&
    weekdays.every((d) => days.includes(d)) &&
    !days.includes("Sat") &&
    !days.includes("Sun")
  )
    return "weekdays";
  if (days.length === 2 && weekend.every((d) => days.includes(d)))
    return "weekends";
  return days.join(", ");
}

function humanizeCondition(cond: any): string {
  const { condition, value } = cond;
  const map: Record<string, string> = {
    charged: `battery ≥ ${value}%`,
    discharged: `battery ≤ ${value}%`,
    backup: "battery at backup reserve",
    homeUsageAbove: `home usage > ${value} kW`,
    homeUsageBelow: `home usage ≤ ${value} kW`,
    solarGenerationAbove: `solar > ${value} kW`,
    solarGenerationBelow: `solar ≤ ${value} kW`,
    gridImportAbove: `grid import > ${value} kW`,
    gridImportBelow: `grid import ≤ ${value} kW`,
    gridExportAbove: `grid export > ${value} kW`,
    gridExportBelow: `grid export ≤ ${value} kW`,
    betweenHours: `between ${value?.from}–${value?.to}`,
    inSeasonalGridChargeWindow: "within peak charge windows",
  };
  return map[condition] ?? condition;
}

function humanizeAction(action: any): string {
  const { action: key, value } = action;
  switch (key) {
    case "setBackupReserve":
      return `set backup reserve to ${value}%`;
    case "setSoftBackupReserve":
      return `set soft backup reserve to ${value}%`;
    case "setOperationalMode":
      return value === "selfPowered"
        ? "switch to self-powered"
        : "switch to time-based control";
    case "setEnergyExports":
      return value === "solarOnly"
        ? "export solar only"
        : "export solar + battery";
    case "setGridCharging":
      return `${value} grid charging`;
    case "setSmartGridCharging": {
      try {
        const parsed = JSON.parse(value);
        return `smart charge to ${parsed.targetSoc}% SOC`;
      } catch {
        return "smart grid charging";
      }
    }
    case "setTouHolidayOverride":
      return "holiday TOU override";
    default:
      return key;
  }
}

function summarizeSchedule(schedule: any): string {
  const actions: any[] = schedule.actions ?? [];
  const conditions: any[] = schedule.conditions ?? [];
  const actionStr = actions.map(humanizeAction).join(", ");

  const isHolidayOverride = actions.some(
    (a) => a.action === "setTouHolidayOverride",
  );
  if (isHolidayOverride) {
    const holidayCond = conditions.find((c) => c.condition === "holidayList");
    const entries: HolidayEntry[] = Array.isArray(holidayCond?.value)
      ? holidayCond.value
      : [];
    const count = entries.length;
    return `Holiday TOU override (${count} holiday${count !== 1 ? "s" : ""})`;
  }

  const isSmartCharging = actions.some(
    (a) => a.action === "setSmartGridCharging",
  );
  if (isSmartCharging) {
    let targetSoc: number | null = null;
    try {
      const sa = actions.find((a) => a.action === "setSmartGridCharging");
      if (sa) targetSoc = JSON.parse(sa.value).targetSoc;
    } catch {
      /* ignore */
    }
    const soc = targetSoc != null ? `${targetSoc}%` : "?%";
    if (conditions.some((c) => c.condition === "inSeasonalGridChargeWindow"))
      return `Smart: charge to ${soc} SOC before peak (TOU)`;
    const between = conditions.find((c) => c.condition === "betweenHours");
    if (between) {
      const { time, days } = parseCronToTimeAndDays(
        schedule.cron ?? "* * * * *",
      );
      const dayStr = days.length ? ` on ${humanizeDays(days)}` : "";
      return `Smart: charge to ${soc} SOC by ${between.value?.to ?? time}${dayStr}`;
    }
    return `Smart: charge to ${soc} SOC`;
  }

  if (!schedule.cron || schedule.cron === "* * * * *") {
    const condStr = conditions.map(humanizeCondition).join(" and ");
    return condStr ? `When ${condStr} → ${actionStr}` : actionStr;
  }

  const { time, days } = parseCronToTimeAndDays(schedule.cron);
  const dayStr = days.length ? humanizeDays(days) : "every day";
  const condStr = conditions.map(humanizeCondition).join(" and ");
  const whenStr = `Every ${dayStr} at ${time}`;
  return condStr
    ? `${whenStr}, if ${condStr} → ${actionStr}`
    : `${whenStr} → ${actionStr}`;
}

function timeAgo(date: Date | string): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

type TabOptions = {
  powerwall: Array<Option>;
  flow: Array<Option>;
};

const tabOptions: TabOptions = {
  powerwall: [
    {
      key: "charged",
      label: "Charged up to:",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "discharged",
      label: "Discharged down to:",
      unit: "%",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "backup",
      label: "Discharged down to backup reserve",
    },
  ],
  flow: [
    {
      key: "homeUsageAbove",
      label: "When home usage rises above:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "homeUsageBelow",
      label: "When home usage drops to or below:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "solarGenerationAbove",
      label: "When solar generation rises above:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "solarGenerationBelow",
      label: "When solar generation drops to or below:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "gridImportAbove",
      label: "When grid import rises above:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "gridImportBelow",
      label: "When grid import drops to or below:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "gridExportAbove",
      label: "When grid export rises above:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
    {
      key: "gridExportBelow",
      label: "When grid export drops to or below:",
      unit: "kW",
      min: 0,
      max: 24,
      step: 0.5,
    },
  ],
};

type TimeSettingsProps = {} & SettingsProps;

function TimeSettings({
  schedule,
  setSchedule,
  setTabValid,
}: TimeSettingsProps) {
  const theme = useTheme();
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<string>("");

  useEffect(() => {
    if (schedule?.cron) {
      const { time, days } = parseCronToTimeAndDays(schedule.cron);
      setTimeOfDay(time);
      setSelectedDays(days);
    }
    setTabValid(schedule?.cron);
  }, [schedule?.cron]);

  const handleDaysChange = (_: any, newDays: string[]) => {
    setSelectedDays(newDays);
    setSchedule((prev: any) => {
      const cron = parseTimeAndDaysToCron(timeOfDay, newDays);
      return { ...prev, cron };
    });
  };

  const handleTimeOfDayChange = (value: Dayjs | null) => {
    const formatted = value?.isValid() ? value.format("HH:mm") : "";
    setTimeOfDay(formatted);
    setSchedule((prev: any) => {
      const cron = parseTimeAndDaysToCron(formatted, selectedDays);
      return { ...prev, cron };
    });
  };

  return (
    <>
      <Typography variant="subtitle1">When:</Typography>
      <Box
        sx={{
          bgcolor: alpha(
            theme.palette.background.paper,
            theme.palette.mode === "light" ? 0.5 : 0.2,
          ),
          borderRadius: 2,
          p: 2,
          mt: 1,
          width: "100%",
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box
          display="flex"
          flexDirection="column"
          alignItems="flex-start"
          gap={1}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <AccessTimeIcon />
            <Typography variant="body2">Time of day</Typography>
          </Box>
          <TimePicker
            value={timeOfDay ? dayjs(`2000-01-01T${timeOfDay}`) : null}
            onChange={handleTimeOfDayChange}
            slotProps={{
              textField: { size: "small", sx: { width: 160, mt: 1 } },
            }}
          />
        </Box>
        <Box
          mt={4}
          display="flex"
          flexDirection="column"
          alignItems="flex-start"
          gap={1}
        >
          <Box display="flex" alignItems="center" gap={1}>
            <CalendarTodayIcon />
            <Typography variant="body2">Repeat</Typography>
          </Box>
          <ToggleButtonGroup
            value={selectedDays}
            onChange={handleDaysChange}
            size="small"
            exclusive={false}
            sx={{ gap: { xs: 0.5, sm: 1 }, mt: 1, flexWrap: "wrap" }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <ToggleButton
                key={day}
                value={day}
                sx={{
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  p: 0,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  overflow: "hidden",
                  transition: "none",
                  "&.Mui-selected": {
                    backgroundColor: theme.palette.action.selected,
                    color: theme.palette.primary.main,
                  },
                  "&.MuiToggleButtonGroup-firstButton": {
                    borderRadius: "50%",
                  },
                  "&.MuiToggleButtonGroup-middleButton": {
                    borderRadius: "50%",
                  },
                  "&.MuiToggleButtonGroup-lastButton": {
                    borderRadius: "50%",
                  },
                }}
              >
                {day}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>
    </>
  );
}

type Option = {
  key: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
};

type DynamicSettingsProps = {
  options: Array<Option>;
  selectedOption: string;
  setSelectedOption: (value: string) => void;
  values: Record<string, number>;
  setValues: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
};

const DynamicSettings = memo(function DynamicSettings({
  options,
  selectedOption,
  setSelectedOption,
  values,
  setValues,
  setSchedule,
}: DynamicSettingsProps & { setSchedule: (row: any) => void }) {
  const keys = options.map((opt) => opt.key);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedSetSchedule = useCallback(
    (key: string, value: number) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSchedule((prevSchedule: any) => {
          const condition: any = { condition: key, value };
          return { ...prevSchedule, conditions: [condition] };
        });
      }, 200);
    },
    [setSchedule],
  );

  const handleValueChange = (key: string, value: number) => {
    setValues((prev) => {
      const updated = { ...prev, [key]: value };
      if (selectedOption === key && keys.includes(key)) {
        debouncedSetSchedule(key, value);
      }
      return updated;
    });
  };

  return (
    <RadioGroup
      value={selectedOption}
      onChange={(e) => setSelectedOption(e.target.value)}
    >
      {options.map((opt, idx) => (
        <Box key={opt.key}>
          <FormControlLabel
            value={opt.key}
            control={<Radio />}
            label={<Typography>{opt.label}</Typography>}
            sx={{ mt: idx > 0 ? 2 : 0 }}
          />
          {opt.min !== undefined &&
            opt.max !== undefined &&
            opt.step !== undefined &&
            opt.unit !== undefined && (
              <Box display="flex" flexDirection="column" gap={1}>
                <Slider
                  value={values[opt.key]}
                  onChange={(_, v) => handleValueChange(opt.key, v as number)}
                  min={opt.min}
                  max={opt.max}
                  step={opt.step}
                  sx={{ width: "100%" }}
                  disabled={selectedOption !== opt.key}
                />
                <TextField
                  value={values[opt.key]}
                  onChange={(e) =>
                    handleValueChange(opt.key, Number(e.target.value))
                  }
                  type="number"
                  inputProps={{ min: opt.min, max: opt.max, step: opt.step }}
                  size="small"
                  sx={{ width: 100 }}
                  disabled={selectedOption !== opt.key}
                  InputProps={{
                    endAdornment: <Typography>{opt.unit}</Typography>,
                  }}
                />
              </Box>
            )}
        </Box>
      ))}
    </RadioGroup>
  );
});

type ConditionType = {
  condition: string;
  value?: number;
};

type PowerwallOptionValuesType = {
  charged: number;
  discharged: number;
  backup: number;
  [key: string]: number;
};

type PowerwallSettingsProps = {
  options: Array<Option>;
  powerwallOption: string;
  setPowerwallOption: (value: string) => void;
  powerwallOptionValues: PowerwallOptionValuesType;
  setPowerwallOptionValues: React.Dispatch<
    React.SetStateAction<PowerwallOptionValuesType>
  >;
} & SettingsProps;

function PowerwallSettings({
  options,
  powerwallOption,
  setPowerwallOption,
  powerwallOptionValues,
  setPowerwallOptionValues,
  schedule,
  setSchedule,
  setTabValid,
}: PowerwallSettingsProps) {
  const theme = useTheme();
  const keys = options.map((opt) => opt.key);

  useEffect(() => {
    if (schedule?.conditions) {
      const conditions: ConditionType[] = schedule.conditions;
      const matchingCondition = Array.isArray(conditions)
        ? conditions.find((cond) => keys.includes(cond.condition))
        : undefined;
      if (matchingCondition) {
        setPowerwallOption(matchingCondition.condition);
        setPowerwallOptionValues((prev) => ({
          ...prev,
          [matchingCondition.condition]: matchingCondition.value ?? -1,
        }));
      }
    }
    setTabValid(!!schedule?.conditions);
    // eslint-disable-next-line
  }, [schedule]);

  return (
    <>
      <Typography variant="subtitle1">
        When Powerwall state of charge is:
      </Typography>
      <Box
        sx={{
          bgcolor: alpha(
            theme.palette.background.paper,
            theme.palette.mode === "light" ? 0.5 : 0.2,
          ),
          borderRadius: 2,
          p: 2,
          mt: 1,
          width: "100%",
          border: 1,
          borderColor: "divider",
        }}
      >
        <DynamicSettings
          options={options}
          selectedOption={powerwallOption}
          setSelectedOption={setPowerwallOption}
          values={powerwallOptionValues}
          setValues={(updater) =>
            setPowerwallOptionValues(
              (prev) => updater(prev) as PowerwallOptionValuesType,
            )
          }
          setSchedule={setSchedule}
        />
      </Box>
    </>
  );
}

type FlowOptionValuesType = {
  homeUsageAbove: number;
  homeUsageBelow: number;
  solarGenerationAbove: number;
  solarGenerationBelow: number;
  gridImportAbove: number;
  gridImportBelow: number;
  gridExportAbove: number;
  gridExportBelow: number;
  [key: string]: number;
};

type FlowSettingsProps = {
  options: Array<Option>;
  flowOption: string;
  setFlowOption: (value: string) => void;
  flowOptionValues: FlowOptionValuesType;
  setFlowOptionValues: React.Dispatch<
    React.SetStateAction<FlowOptionValuesType>
  >;
} & SettingsProps;

function FlowSettings({
  options,
  flowOption,
  setFlowOption,
  flowOptionValues,
  setFlowOptionValues,
  schedule,
  setSchedule,
  setTabValid,
}: FlowSettingsProps) {
  const theme = useTheme();

  const keys = options.map((opt) => opt.key);

  useEffect(() => {
    if (schedule?.conditions) {
      const conditions: ConditionType[] = schedule.conditions;
      const matchingCondition = Array.isArray(conditions)
        ? conditions.find((cond) => keys.includes(cond.condition))
        : undefined;
      if (matchingCondition) {
        setFlowOption(matchingCondition.condition);
        setFlowOptionValues((prev) => ({
          ...prev,
          [matchingCondition.condition]: matchingCondition.value ?? 0,
        }));
      }
    }
    setTabValid(schedule?.conditions);
  }, [schedule?.conditions]);

  return (
    <>
      <Typography variant="subtitle1">
        When Powerwall state of charge is:
      </Typography>
      <Box
        sx={{
          bgcolor: alpha(
            theme.palette.background.paper,
            theme.palette.mode === "light" ? 0.5 : 0.2,
          ),
          borderRadius: 2,
          p: 2,
          mt: 1,
          width: "100%",
          border: 1,
          borderColor: "divider",
        }}
      >
        <DynamicSettings
          options={options}
          selectedOption={flowOption}
          setSelectedOption={setFlowOption}
          values={flowOptionValues}
          setValues={(updater) =>
            setFlowOptionValues((prev) => updater(prev) as FlowOptionValuesType)
          }
          setSchedule={setSchedule}
        />
      </Box>
    </>
  );
}

type ActionProps = {
  selectedAction: string | null;
  setSelectedAction: (action: string | null) => void;
  actionValues: { [key: string]: string | number | null };
  setActionValues: React.Dispatch<
    React.SetStateAction<{ [key: string]: string | number | null }>
  >;
  setSchedule: (row: any) => void;
  schedule?: any;
  excludeKeys?: string[];
};

function ActionList({
  setSelectedAction,
  actionValues,
  setActionValues,
  excludeKeys,
}: ActionProps) {
  const theme = useTheme();
  const allActions = [
    {
      key: "setBackupReserve",
      label: "Set backup reserve",
      icon: <BatteryFullIcon />,
    },
    {
      key: "setSoftBackupReserve",
      label: "Preserve battery charge",
      icon: <BatteryFullIcon />,
    },
    {
      key: "setOperationalMode",
      label: "Set operational mode",
      icon: <SettingsIcon />,
    },
    {
      key: "setEnergyExports",
      label: "Set energy exports",
      icon: <BoltIcon />,
    },
    { key: "setGridCharging", label: "Set grid charging", icon: <PowerIcon /> },
    {
      key: "calibrate_grid_charge_rate",
      label: "Calibrate grid charge rate",
      icon: <ScienceIcon />,
    },
    {
      key: "calibrate_charge_curve",
      label: "Calibrate charge curve",
      icon: <ShowChartIcon />,
    },
  ];
  const actions = excludeKeys
    ? allActions.filter((a) => !excludeKeys.includes(a.key))
    : allActions;
  return (
    <>
      <Typography variant="subtitle1" mt={2}>
        Choose one or more actions:
      </Typography>
      <List>
        {actions.map((action) => (
          <ListItem
            key={action.key}
            component="button"
            secondaryAction={<ChevronRightIcon />}
            sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
            onClick={() => setSelectedAction(action.key)}
          >
            <ListItemAvatar>
              <Badge
                color="success"
                overlap="circular"
                badgeContent={
                  actionValues[action.key] != null ? (
                    <CheckIcon sx={{ fontSize: 14 }} />
                  ) : null
                }
                anchorOrigin={{ vertical: "top", horizontal: "right" }}
                sx={{
                  "& .MuiBadge-badge": {
                    minWidth: 16,
                    height: 16,
                    padding: 0,
                    borderRadius: "50%",
                  },
                }}
              >
                <Avatar>{action.icon}</Avatar>
              </Badge>
            </ListItemAvatar>
            <ListItemText primary={action.label} />
          </ListItem>
        ))}
      </List>
    </>
  );
}

const CALIBRATION_ACTIONS = new Set([
  "calibrate_grid_charge_rate",
  "calibrate_charge_curve",
]);

function nextCronOccurrence(cron: string): Date | null {
  if (!cron || cron === "* * * * *") return null;
  const { time, days } = parseCronToTimeAndDays(cron);
  if (!time || days.length === 0) return null;
  const [hour, minute] = time.split(":").map(Number);
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const now = new Date();
  let earliest: Date | null = null;
  for (const day of days) {
    const targetDow = dayMap[day] ?? 0;
    const candidate = new Date(now);
    candidate.setHours(hour, minute, 0, 0);
    let diff = targetDow - now.getDay();
    if (diff < 0 || (diff === 0 && candidate <= now)) diff += 7;
    candidate.setDate(candidate.getDate() + diff);
    if (!earliest || candidate < earliest) earliest = candidate;
  }
  return earliest;
}

function ActionConfigDialog({
  selectedAction,
  setSelectedAction,
  actionValues,
  setActionValues,
  setSchedule,
  schedule,
}: ActionProps) {
  const theme = useTheme();
  const actionConfig: {
    [key: string]: {
      label: string;
      description?: string;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      options?: Array<{ key: string; label: string; description: string }>;
    };
  } = {
    setBackupReserve: {
      label: "Set Backup Reserve",
      description:
        "Backup reserve determines how much of you Powerwall's stored energy will automatically be saved for backup use. Setting it higher than the current state of charge will charge up the battery from solar or grid.",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
    },
    setSoftBackupReserve: {
      label: "Preserve battery charge",
      description:
        "Set the Powerwall backup reserve to its current state of charge. This will avoid discharging the battery, for example when charging an EV.",
    },
    setOperationalMode: {
      label: "Set Operational Mode",
      options: [
        {
          key: "selfPowered",
          label: "Self Powered",
          description:
            "Use stored energy to power your home after the sun goes down. Reduces your reliance on the grid.",
        },
        {
          key: "timeBasedControl",
          label: "Time-Based Control",
          description:
            "Use stored energy to maximize savings based on your utility plan. Gives you the lowest energy bill.",
        },
      ],
    },
    setEnergyExports: {
      label: "Set Energy Exports",
      options: [
        {
          key: "solarOnly",
          label: "Solar Only",
          description:
            "In Time-Based Control, your system will only send solar energy to the grid during high-value time periods. Stored Powerwall energy will serve home loads.",
        },
        {
          key: "everything",
          label: "Everything (solar and battery)",
          description:
            "Powerwall will export both solar production and stored Powerwall energy to the grid during high-cost time periods.",
        },
      ],
    },
    setGridCharging: {
      label: "Set Grid Charging",
      options: [
        {
          key: "enabled",
          label: "Enabled",
          description:
            "Powerwall will charge from the grid to your backup reserve and for daily use in Time-Based Control.",
        },
        {
          key: "disabled",
          label: "Disabled",
          description:
            "Powerwall will not charge from the grid and only use solar energy to charge the battery.",
        },
      ],
    },
    setSmartGridCharging: {
      label: "Smart Grid Charging",
      description:
        "Charges the battery to the target level before each on-peak period. Grid charging supplements solar only when solar alone cannot reach the target in time. Automatically disabled when the peak period begins.",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
    },
    calibrate_grid_charge_rate: {
      label: "Calibrate Grid Charge Rate",
      description:
        "Runs grid charge rate calibration for each selected site. Requires SOC < 80%, solar < 0.1 kW, on-grid, and off-peak. If conditions are not met at run time, the occurrence is skipped and you will receive an email.",
    },
    calibrate_charge_curve: {
      label: "Calibrate Charge Curve",
      description:
        "Runs charge curve calibration for each selected site (up to 3 h). Requires SOC < 85%, on-grid, and off-peak. If conditions are not met at run time, the occurrence is skipped and you will receive an email.",
    },
  };
  const [tempValue, setTempValue] = useState<string | number | null>(null);
  const [peakWarning, setPeakWarning] = useState<{
    hasTouData: boolean;
    inPeak: boolean;
  } | null>(null);
  useEffect(() => {
    if (selectedAction !== null) {
      const config = actionConfig[selectedAction];
      let raw: string | number | null = actionValues[selectedAction];
      let initial: string | number | null;
      if (selectedAction === "setSmartGridCharging") {
        // Value is a JSON string; extract targetSoc for the slider.
        if (raw != null) {
          try {
            initial = (JSON.parse(raw as string) as { targetSoc: number })
              .targetSoc;
          } catch {
            initial = config.max ?? 90;
          }
        } else {
          initial = config.max ?? 90;
        }
      } else if (raw == null) {
        if (config.options && config.options.length > 0) {
          initial = null;
        } else if (config.max !== undefined) {
          initial = config.max;
        } else {
          initial = 0;
        }
      } else {
        initial = raw;
      }
      setTempValue(initial);
    } else {
      setTempValue(null);
    }
  }, [selectedAction, actionValues]);

  useEffect(() => {
    if (!selectedAction || !CALIBRATION_ACTIONS.has(selectedAction)) {
      setPeakWarning(null);
      return;
    }
    const cron = schedule?.cron as string | undefined;
    if (!cron) {
      setPeakWarning(null);
      return;
    }
    const { time, days } = parseCronToTimeAndDays(cron);
    if (!time) {
      setPeakWarning(null);
      return;
    }
    const siteId = (schedule?.site_ids as string[] | undefined)?.[0];
    if (!siteId) {
      setPeakWarning(null);
      return;
    }
    const [hour, minute] = time.split(":").map(Number);
    // Tesla DOW: 0=Mon…6=Sun
    const DAY_TO_TESLA_DOW: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    const teslaDows = days
      .map((d) => DAY_TO_TESLA_DOW[d] ?? -1)
      .filter((n) => n >= 0);
    const params = new URLSearchParams({
      siteId,
      hour: String(hour),
      minute: String(minute),
      daysOfWeek: teslaDows.join(","),
    });
    axios
      .get(`/api/calibration/peak-status?${params}`)
      .then((res) => setPeakWarning(res.data.data))
      .catch(() => setPeakWarning(null));
  }, [selectedAction, schedule?.cron, schedule?.site_ids]);

  if (!selectedAction) return null;
  const config = actionConfig[selectedAction];
  const value = tempValue ?? 20;
  return (
    <Dialog open onClose={() => setSelectedAction(null)} maxWidth="xs">
      <DialogTitle sx={{ position: "relative", pb: 2, pl: 7 }}>
        <Box sx={{ position: "absolute", top: 11, left: 8 }}>
          <IconButton onClick={() => setSelectedAction(null)}>
            <ChevronRightIcon sx={{ transform: "rotate(180deg)" }} />
          </IconButton>
        </Box>
        <Box textAlign="center">
          <Typography variant="h6">{config.label}</Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={1}>
          {config.description && (
            <Typography variant="body2">{config.description}</Typography>
          )}
          {CALIBRATION_ACTIONS.has(selectedAction) &&
            peakWarning?.hasTouData &&
            peakWarning.inPeak && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                The next scheduled occurrence falls within an on-peak period.
                Calibration will be skipped and you will receive an email.
              </Alert>
            )}
          {config.min !== undefined &&
            config.max !== undefined &&
            config.step !== undefined &&
            config.unit !== undefined && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 3 }}>
                  {config.label}
                </Typography>
                <Slider
                  value={typeof value === "string" ? Number(value) : value}
                  min={config.min}
                  max={config.max}
                  step={config.step}
                  onChange={(_, v) => setTempValue(v as number)}
                />
                <TextField
                  type="number"
                  value={value}
                  onChange={(e) => setTempValue(Number(e.target.value))}
                  slotProps={{
                    htmlInput: {
                      min: config.min,
                      max: config.max,
                      step: config.step,
                    },
                    input: {
                      endAdornment: <Typography>{config.unit}</Typography>,
                    },
                  }}
                  size="small"
                  sx={{ width: 100, mt: 2 }}
                />
              </>
            )}
          {config.options && (
            <Box display="flex" flexDirection="column" gap={2} mt={2}>
              {config.options.map((option) => {
                const selected = tempValue === option.key;
                return (
                  <Box
                    key={option.key}
                    onClick={() => setTempValue(option.key)}
                    sx={{
                      cursor: "pointer",
                      opacity: 1,
                      pointerEvents: "auto",
                      flexDirection: "column",
                      alignItems: "center",
                      py: 2,
                      px: 2,
                      border: selected
                        ? `2px solid ${theme.palette.primary.main}`
                        : "1px solid",
                      borderColor: selected
                        ? theme.palette.primary.main
                        : "divider",
                      borderRadius: 2,
                      bgcolor: selected
                        ? theme.palette.action.selected
                        : "background.paper",
                      boxShadow: selected ? 2 : 0,
                      transition: "all 0.2s",
                      display: "flex",
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      align="center"
                      sx={{ fontWeight: 600 }}
                    >
                      {option.label}
                    </Typography>
                    <Typography
                      variant="body2"
                      align="left"
                      sx={{ mt: 1, width: "100%" }}
                    >
                      {option.description}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {actionValues[selectedAction] != null && (
          <Button
            color="warning"
            onClick={() => {
              setActionValues((prev) => {
                const updated = { ...prev, [selectedAction]: null };
                setSchedule((prevSchedule: any) => ({
                  ...prevSchedule,
                  actions: Object.entries(updated)
                    .filter(([_, value]) => value != null)
                    .map(([key, value]) => ({ action: key, value })),
                }));
                return updated;
              });
              setSelectedAction(null);
            }}
          >
            Unset
          </Button>
        )}
        <Button
          variant="contained"
          color="primary"
          onClick={() => {
            const serialized = CALIBRATION_ACTIONS.has(selectedAction)
              ? "{}"
              : selectedAction === "setSmartGridCharging"
                ? JSON.stringify({ targetSoc: Number(tempValue) })
                : tempValue;
            setActionValues((prev) => {
              const updated = { ...prev, [selectedAction]: serialized };
              setSchedule((prevSchedule: any) => ({
                ...prevSchedule,
                actions: Object.entries(updated)
                  .filter(([_, value]) => value !== null)
                  .map(([key, value]) => ({ action: key, value })),
              }));
              return updated;
            });
            setSelectedAction(null);
          }}
        >
          Set
        </Button>
      </DialogActions>
    </Dialog>
  );
}

type BetweenHoursProps = Pick<SettingsProps, "schedule" | "setSchedule">;

function BetweenHours({ schedule, setSchedule }: BetweenHoursProps) {
  const theme = useTheme();
  const [betweenHours, setBetweenHours] = useState<{
    from: string;
    to: string;
  }>({
    from: "",
    to: "",
  });

  useEffect(() => {
    const condition = schedule?.conditions?.find(
      (c: any) => c.condition === "betweenHours",
    );
    if (condition && condition.value) {
      setBetweenHours(condition.value);
    }
    // else {
    //   setBetweenHours({ from: "", to: "" });
    // }
  }, [schedule?.conditions]);

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFrom = e.target.value;
    setBetweenHours({ ...betweenHours, from: newFrom });
    setSchedule((prev: any) => {
      const filtered = (prev.conditions || []).filter(
        (c: any) => c.condition !== "betweenHours",
      );
      if (newFrom && betweenHours.to) {
        return {
          ...prev,
          conditions: [
            ...filtered,
            {
              condition: "betweenHours",
              value: { from: newFrom, to: betweenHours.to },
            },
          ],
        };
      } else {
        return { ...prev, conditions: filtered };
      }
    });
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTo = e.target.value;
    setBetweenHours({ ...betweenHours, to: newTo });
    setSchedule((prev: any) => {
      const filtered = (prev.conditions || []).filter(
        (c: any) => c.condition !== "betweenHours",
      );
      if (betweenHours.from && newTo) {
        return {
          ...prev,
          conditions: [
            ...filtered,
            {
              condition: "betweenHours",
              value: { from: betweenHours.from, to: newTo },
            },
          ],
        };
      } else {
        return { ...prev, conditions: filtered };
      }
    });
  };

  return (
    <Box
      sx={{
        bgcolor: alpha(
          theme.palette.background.paper,
          theme.palette.mode === "light" ? 0.5 : 0.2,
        ),
        borderRadius: 2,
        p: 2,
        mt: 2,
        width: "100%",
        border: 1,
        borderColor: "divider",
      }}
      display="flex"
      flexDirection="column"
      alignItems="flex-start"
      gap={1}
    >
      <Box display="flex" alignItems="center" gap={1}>
        <AccessTimeIcon />
        <Typography variant="body2">
          Optional: Only between the hours of
        </Typography>
      </Box>
      <Box display="flex" alignItems="center" gap={1}>
        <TextField
          type="time"
          size="small"
          sx={{ width: 120, mt: 1 }}
          value={betweenHours.from || ""}
          onChange={handleFromChange}
        />
        <Typography variant="body2">and</Typography>
        <TextField
          type="time"
          size="small"
          sx={{ width: 120, mt: 1 }}
          value={betweenHours.to || ""}
          onChange={handleToChange}
        />
      </Box>
    </Box>
  );
}

type SeasonalWindow = { seasonName: string; from: string; to: string };

type TariffInfo = { hasTou: boolean; seasons: string[] } | null;

function validateWindow(
  from: string,
  to: string,
): { fromError: boolean; toError: boolean; message: string | null } {
  if (from && to && from >= to)
    return {
      fromError: true,
      toError: true,
      message: "Earliest must be before Latest",
    };
  return { fromError: false, toError: false, message: null };
}

type SmartSettingsProps = {
  schedule: any;
  setSchedule: (row: any) => void;
  setTabValid: (valid: boolean) => void;
  actionValues: { [key: string]: string | number | null };
  setSelectedAction: (action: string | null) => void;
  tariffInfo: TariffInfo;
  smartMode: "tou" | "customDays";
  setSmartMode: (mode: "tou" | "customDays") => void;
  smartDays: string[];
  setSmartDays: (days: string[]) => void;
  smartWindow: { from: string; to: string };
  setSmartWindow: (w: { from: string; to: string }) => void;
  smartSeasonalWindows: SeasonalWindow[];
  setSmartSeasonalWindows: (windows: SeasonalWindow[]) => void;
};

function SmartSettings({
  schedule,
  setSchedule,
  setTabValid,
  actionValues,
  setSelectedAction,
  tariffInfo,
  smartMode,
  setSmartMode,
  smartDays,
  setSmartDays,
  smartWindow,
  setSmartWindow,
  smartSeasonalWindows,
  setSmartSeasonalWindows,
}: SmartSettingsProps) {
  const theme = useTheme();

  const seasonalWindowErrors = useMemo(
    () =>
      smartSeasonalWindows.map((sw) => ({
        seasonName: sw.seasonName,
        ...validateWindow(sw.from, sw.to),
      })),
    [smartSeasonalWindows],
  );

  const customWindowError = useMemo(
    () => validateWindow(smartWindow.from, smartWindow.to),
    [smartWindow],
  );

  const windowsValid = useMemo(() => {
    if (smartMode === "tou")
      return seasonalWindowErrors.every((e) => !e.fromError && !e.toError);
    return !customWindowError.fromError && !customWindowError.toError;
  }, [smartMode, seasonalWindowErrors, customWindowError]);

  const updateScheduleForCurrentMode = useCallback(
    (
      mode: "tou" | "customDays",
      days: string[],
      window: { from: string; to: string },
      seasonalWindows: SeasonalWindow[],
    ) => {
      if (mode === "tou") {
        setSchedule((prev: any) => ({
          ...prev,
          cron: "* * * * *",
          conditions:
            seasonalWindows.length > 0
              ? [
                  {
                    condition: "inSeasonalGridChargeWindow",
                    value: seasonalWindows,
                  },
                ]
              : [],
        }));
      } else {
        const dowMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const dow =
          days.length === 0
            ? "*"
            : days.map((d) => String(dowMap.indexOf(d))).join(",");
        const cron = `* * * * ${dow}`;
        const conditions =
          window.from && window.to
            ? [
                {
                  condition: "betweenHours",
                  value: { from: window.from, to: window.to },
                },
              ]
            : [];
        setSchedule((prev: any) => ({ ...prev, cron, conditions }));
      }
    },
    [setSchedule],
  );

  useEffect(() => {
    const hasSmartAction = actionValues.setSmartGridCharging != null;
    const modeValid =
      smartMode === "tou"
        ? tariffInfo?.hasTou === true
        : smartDays.length > 0 && smartWindow.to !== "";
    setTabValid(hasSmartAction && modeValid && windowsValid);
  }, [
    actionValues.setSmartGridCharging,
    smartMode,
    tariffInfo,
    smartDays,
    smartWindow,
    windowsValid,
    setTabValid,
  ]);

  const handleModeChange = (newMode: "tou" | "customDays") => {
    setSmartMode(newMode);
    updateScheduleForCurrentMode(
      newMode,
      smartDays,
      smartWindow,
      smartSeasonalWindows,
    );
  };

  const handleDaysChange = (_: any, newDays: string[]) => {
    setSmartDays(newDays);
    updateScheduleForCurrentMode(
      "customDays",
      newDays,
      smartWindow,
      smartSeasonalWindows,
    );
  };

  const handleWindowChange = (field: "from" | "to", val: string) => {
    const newWindow = { ...smartWindow, [field]: val };
    setSmartWindow(newWindow);
    updateScheduleForCurrentMode(
      "customDays",
      smartDays,
      newWindow,
      smartSeasonalWindows,
    );
  };

  const handleSeasonalWindowChange = (
    seasonName: string,
    field: "from" | "to",
    val: string,
  ) => {
    const newWindows = smartSeasonalWindows.map((w) =>
      w.seasonName === seasonName ? { ...w, [field]: val } : w,
    );
    setSmartSeasonalWindows(newWindows);
    updateScheduleForCurrentMode("tou", smartDays, smartWindow, newWindows);
  };

  const smartActionValue = actionValues.setSmartGridCharging;
  let targetSocLabel: string | null = null;
  if (smartActionValue != null) {
    try {
      const parsed = JSON.parse(smartActionValue as string) as {
        targetSoc: number;
      };
      targetSocLabel = `Target: ${parsed.targetSoc}%`;
    } catch {
      targetSocLabel = null;
    }
  }

  return (
    <Box>
      <Typography variant="subtitle1" mt={1}>
        Mode
      </Typography>
      <RadioGroup
        row
        value={smartMode}
        onChange={(e) =>
          handleModeChange(e.target.value as "tou" | "customDays")
        }
        sx={{ mt: 0.5, mb: 1 }}
      >
        <FormControlLabel
          value="tou"
          control={<Radio size="small" />}
          label="Follow TOU schedule"
        />
        <FormControlLabel
          value="customDays"
          control={<Radio size="small" />}
          label="Custom days"
        />
      </RadioGroup>

      {smartMode === "tou" && !tariffInfo?.hasTou && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No Time-of-Use tariff found for this site. Configure a TOU tariff in
          the Tesla app to use this mode.
        </Alert>
      )}

      {smartMode === "customDays" && (
        <Box mb={2}>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <CalendarTodayIcon fontSize="small" />
            <Typography variant="body2">Days</Typography>
          </Box>
          <ToggleButtonGroup
            value={smartDays}
            onChange={handleDaysChange}
            size="small"
            exclusive={false}
            sx={{ gap: { xs: 0.5, sm: 1 }, flexWrap: "wrap" }}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <ToggleButton
                key={day}
                value={day}
                sx={{
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  p: 0,
                  fontWeight: 500,
                  "&.Mui-selected": {
                    backgroundColor: theme.palette.action.selected,
                    color: theme.palette.primary.main,
                  },
                  "&.MuiToggleButtonGroup-firstButton": { borderRadius: "50%" },
                  "&.MuiToggleButtonGroup-middleButton": {
                    borderRadius: "50%",
                  },
                  "&.MuiToggleButtonGroup-lastButton": { borderRadius: "50%" },
                }}
              >
                {day}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}

      <Box
        sx={{
          bgcolor: alpha(
            theme.palette.background.paper,
            theme.palette.mode === "light" ? 0.5 : 0.2,
          ),
          borderRadius: 2,
          p: 2,
          mb: 2,
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <BoltIcon fontSize="small" />
          <Typography variant="body2">
            Allowed Grid Charge Hours
            {smartMode === "customDays" ? " (optional)" : ""}
          </Typography>
        </Box>

        {smartMode === "tou" && (tariffInfo?.seasons ?? []).length > 0 ? (
          <Box>
            <Box sx={{ overflowX: "auto" }}>
              {/* Single grid so header and data columns always share the same widths */}
              <Box
                display="grid"
                gridTemplateColumns="auto max-content max-content"
                columnGap={1}
                rowGap={1}
                alignItems="center"
              >
                <Typography variant="caption" color="text.secondary">
                  Season
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Earliest
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Latest
                </Typography>
                {smartSeasonalWindows.map((sw) => {
                  const err = seasonalWindowErrors.find(
                    (e: { seasonName: string }) =>
                      e.seasonName === sw.seasonName,
                  );
                  return (
                    <>
                      <Typography
                        key={`${sw.seasonName}-label`}
                        variant="body2"
                        sx={{ textTransform: "capitalize" }}
                      >
                        {sw.seasonName}
                      </Typography>
                      <TimePicker
                        key={`${sw.seasonName}-from`}
                        value={sw.from ? dayjs(`2000-01-01T${sw.from}`) : null}
                        onChange={(v: Dayjs | null) =>
                          handleSeasonalWindowChange(
                            sw.seasonName,
                            "from",
                            v ? v.format("HH:mm") : "",
                          )
                        }
                        minutesStep={15}
                        slotProps={{
                          field: { clearable: true },
                          textField: {
                            size: "small",
                            sx: { width: 170 },
                            error: err?.fromError,
                          },
                        }}
                      />
                      <TimePicker
                        key={`${sw.seasonName}-to`}
                        value={sw.to ? dayjs(`2000-01-01T${sw.to}`) : null}
                        onChange={(v: Dayjs | null) =>
                          handleSeasonalWindowChange(
                            sw.seasonName,
                            "to",
                            v ? v.format("HH:mm") : "",
                          )
                        }
                        minutesStep={15}
                        slotProps={{
                          field: { clearable: true },
                          textField: {
                            size: "small",
                            sx: { width: 170 },
                            error: err?.toError,
                          },
                        }}
                      />
                    </>
                  );
                })}
              </Box>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              mt={1}
              display="block"
            >
              Leave blank for open-ended (midnight). Earliest must be before
              Latest.
            </Typography>
            {seasonalWindowErrors.some((e) => e.message) && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {seasonalWindowErrors
                  .filter((e) => e.message)
                  .map((e) => (
                    <Box
                      key={e.seasonName}
                      sx={{ textTransform: "capitalize" }}
                    >
                      {e.seasonName}: {e.message}
                    </Box>
                  ))}
              </Alert>
            )}
          </Box>
        ) : smartMode === "tou" ? (
          <Typography variant="body2" color="text.secondary">
            Season information will appear once a TOU tariff is detected.
          </Typography>
        ) : (
          <Box>
            <Box display="flex" alignItems="center" gap={1}>
              <TimePicker
                label="Earliest"
                value={
                  smartWindow.from
                    ? dayjs(`2000-01-01T${smartWindow.from}`)
                    : null
                }
                onChange={(v: Dayjs | null) =>
                  handleWindowChange("from", v ? v.format("HH:mm") : "")
                }
                minutesStep={15}
                slotProps={{
                  field: { clearable: true },
                  textField: {
                    size: "small",
                    sx: { width: 170 },
                    error: customWindowError.fromError,
                  },
                }}
              />
              <TimePicker
                label="Latest / Charge by"
                value={
                  smartWindow.to ? dayjs(`2000-01-01T${smartWindow.to}`) : null
                }
                onChange={(v: Dayjs | null) =>
                  handleWindowChange("to", v ? v.format("HH:mm") : "")
                }
                minutesStep={15}
                slotProps={{
                  field: { clearable: true },
                  textField: {
                    size: "small",
                    sx: { width: 175 },
                    error: customWindowError.toError,
                  },
                }}
              />
            </Box>
            {customWindowError.message && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {customWindowError.message}
              </Alert>
            )}
          </Box>
        )}
      </Box>

      <Typography variant="subtitle1">Actions</Typography>
      <List disablePadding>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mt: 1 }}
          onClick={() => setSelectedAction("setSmartGridCharging")}
        >
          <ListItemAvatar>
            <Badge
              color="success"
              overlap="circular"
              badgeContent={
                smartActionValue != null ? (
                  <CheckIcon sx={{ fontSize: 14 }} />
                ) : null
              }
              anchorOrigin={{ vertical: "top", horizontal: "right" }}
              sx={{
                "& .MuiBadge-badge": {
                  minWidth: 16,
                  height: 16,
                  padding: 0,
                  borderRadius: "50%",
                },
              }}
            >
              <Avatar>
                <BoltIcon />
              </Avatar>
            </Badge>
          </ListItemAvatar>
          <ListItemText
            primary="Smart Grid Charging"
            secondary={targetSocLabel}
          />
        </ListItem>
      </List>
    </Box>
  );
}

function SiteSelector({
  schedule,
  setSchedule,
  availableSites,
}: {
  schedule: any;
  setSchedule: (s: any) => void;
  availableSites: SiteWithTimezone[];
}) {
  const selected: string[] = schedule?.site_ids ?? [];

  // Determine the locked timezone from already-selected sites.
  const lockedTimezone =
    selected.length > 0
      ? (availableSites.find((s) => s.id === selected[0])?.timezone ?? null)
      : null;

  const handleChange = (event: any) => {
    const newIds = event.target.value as string[];
    // Derive timezone from the first selected site.
    const firstSite = availableSites.find((s) => s.id === newIds[0]);
    const tz =
      firstSite?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    setSchedule({ ...schedule, site_ids: newIds, timezone: tz });
  };

  const renderValue = (selectedIds: string[]) =>
    selectedIds
      .map((id) => availableSites.find((s) => s.id === id)?.site_name ?? id)
      .join(", ") || "No sites selected";

  return (
    <FormControl fullWidth size="small" sx={{ mt: 1, mb: 1 }}>
      <InputLabel id="site-selector-label">Target Sites</InputLabel>
      <Select
        labelId="site-selector-label"
        multiple
        value={selected}
        onChange={handleChange}
        input={<OutlinedInput label="Target Sites" />}
        renderValue={renderValue}
      >
        {availableSites.map((site) => {
          const tzMismatch =
            lockedTimezone !== null &&
            site.timezone !== undefined &&
            site.timezone !== lockedTimezone &&
            !selected.includes(site.id);
          return (
            <MenuItem key={site.id} value={site.id} disabled={tzMismatch}>
              <Checkbox checked={selected.includes(site.id)} />
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: site.is_online ? "success.main" : "action.disabled",
                  mr: 1,
                  flexShrink: 0,
                }}
              />
              <ListItemText
                primary={site.site_name}
                secondary={tzMismatch ? "Different timezone" : undefined}
              />
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
}

type HolidaysSettingsProps = {
  holidayEntries: HolidayEntry[];
  setHolidayEntries: (entries: HolidayEntry[]) => void;
  autoPopulateOpen: boolean;
  setAutoPopulateOpen: (open: boolean) => void;
  autoPopulateSource: string;
  setAutoPopulateSource: (source: string) => void;
  autoPopulateSelected: HolidayEntry[];
  setAutoPopulateSelected: (entries: HolidayEntry[]) => void;
  addHolidayOpen: boolean;
  setAddHolidayOpen: (open: boolean) => void;
  newHolidayName: string;
  setNewHolidayName: (name: string) => void;
  newHolidayType: "fixed" | "floating";
  setNewHolidayType: (type: "fixed" | "floating") => void;
  newHolidayMonth: number;
  setNewHolidayMonth: (month: number) => void;
  newHolidayDay: number;
  setNewHolidayDay: (day: number) => void;
  newHolidayObservance: "auto" | "none";
  setNewHolidayObservance: (obs: "auto" | "none") => void;
  newHolidayOrdinal: string;
  setNewHolidayOrdinal: (ord: string) => void;
  newHolidayDow: string;
  setNewHolidayDow: (dow: string) => void;
  autoPopulateToolbarSource: string;
  setAutoPopulateToolbarSource: (source: string) => void;
};

function HolidaysSettings({
  holidayEntries,
  setHolidayEntries,
  autoPopulateOpen,
  setAutoPopulateOpen,
  autoPopulateSource,
  setAutoPopulateSource,
  autoPopulateSelected,
  setAutoPopulateSelected,
  addHolidayOpen,
  setAddHolidayOpen,
  newHolidayName,
  setNewHolidayName,
  newHolidayType,
  setNewHolidayType,
  newHolidayMonth,
  setNewHolidayMonth,
  newHolidayDay,
  setNewHolidayDay,
  newHolidayObservance,
  setNewHolidayObservance,
  newHolidayOrdinal,
  setNewHolidayOrdinal,
  newHolidayDow,
  setNewHolidayDow,
  autoPopulateToolbarSource,
  setAutoPopulateToolbarSource,
}: HolidaysSettingsProps) {
  const theme = useTheme();

  const handleDeleteEntry = (idx: number) => {
    setHolidayEntries(holidayEntries.filter((_, i) => i !== idx));
  };

  const handleOpenAutoPopulate = () => {
    setAutoPopulateSource(autoPopulateToolbarSource);
    const templates = generateHolidayTemplates(autoPopulateToolbarSource);
    setAutoPopulateSelected(templates);
    setAutoPopulateOpen(true);
  };

  const handleAddSelected = () => {
    const existingKeys = new Set(
      holidayEntries.map((e) => `${e.date}:${e.name}`),
    );
    const newEntries = autoPopulateSelected.filter(
      (e) => !existingKeys.has(`${e.date}:${e.name}`),
    );
    setHolidayEntries([...holidayEntries, ...newEntries]);
    setAutoPopulateOpen(false);
  };

  const handleSaveNewHoliday = () => {
    let dateStr: string;
    if (newHolidayType === "fixed") {
      const mm = String(newHolidayMonth).padStart(2, "0");
      const dd = String(newHolidayDay).padStart(2, "0");
      dateStr = `${mm}-${dd}`;
    } else {
      const mm = String(newHolidayMonth).padStart(2, "0");
      dateStr = `${newHolidayOrdinal}${newHolidayDow}${mm}`;
    }
    const entry: HolidayEntry = {
      name: newHolidayName.trim(),
      date: dateStr,
      observance: newHolidayType === "floating" ? "none" : newHolidayObservance,
      source: "CUSTOM",
      enabled: true,
    };
    setHolidayEntries([...holidayEntries, entry]);
    setAddHolidayOpen(false);
    setNewHolidayName("");
    setNewHolidayType("fixed");
    setNewHolidayMonth(1);
    setNewHolidayDay(1);
    setNewHolidayObservance("auto");
    setNewHolidayOrdinal("1st");
    setNewHolidayDow("Mon");
  };

  const daysInMonth = (month: number) => {
    const days30 = [4, 6, 9, 11];
    if (month === 2) return 28;
    if (days30.includes(month)) return 30;
    return 31;
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Alert severity="info" sx={{ mb: 1 }}>
        Fires at midnight local time every night. On observed holidays the TOU
        schedule is switched to weekend mode; the original schedule is restored
        the following midnight.
      </Alert>
      <Alert severity="warning" sx={{ mb: 2 }}>
        The Tesla app cannot display a schedule that has no on-peak periods. On
        holidays the TOU override uses weekend-style (all off-peak) periods, so
        the Tesla app will show a blank schedule for that day. This is a Tesla
        app display limitation and does not affect automation behaviour.
      </Alert>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 1,
          flexWrap: "wrap",
        }}
      >
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Source</InputLabel>
          <Select
            value={autoPopulateToolbarSource}
            label="Source"
            onChange={(e) => setAutoPopulateToolbarSource(e.target.value)}
          >
            {HOLIDAY_SOURCES.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          size="small"
          onClick={handleOpenAutoPopulate}
          disabled={autoPopulateToolbarSource === "CUSTOM"}
        >
          Populate
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddHolidayOpen(true)}
        >
          Add custom
        </Button>
      </Box>

      {holidayEntries.length === 0 ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          No holidays configured. Use "Populate" to add from a template or "+
          Add custom" to add individual holidays.
        </Alert>
      ) : (
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
            mt: 1,
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 130px 60px 80px 36px",
              bgcolor: alpha(
                theme.palette.background.paper,
                theme.palette.mode === "light" ? 0.5 : 0.2,
              ),
              borderBottom: 1,
              borderColor: "divider",
              px: 1,
              py: 0.5,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Name
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Date
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Observ.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Source
            </Typography>
            <span />
          </Box>
          {holidayEntries.map((entry, idx) => (
            <Box
              key={idx}
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr 130px 60px 80px 36px",
                alignItems: "center",
                px: 1,
                py: 0.25,
                borderBottom: idx < holidayEntries.length - 1 ? 1 : 0,
                borderColor: "divider",
                "&:hover": { bgcolor: alpha(theme.palette.action.hover, 0.04) },
              }}
            >
              <Tooltip title={entry.name} placement="top">
                <Typography
                  variant="body2"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.name}
                </Typography>
              </Tooltip>
              <Typography variant="body2" color="text.secondary">
                {formatHolidayDate(entry.date)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {/^\d{2}-\d{2}$/.test(entry.date)
                  ? entry.observance === "auto"
                    ? "Auto"
                    : "None"
                  : "—"}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.source}
              </Typography>
              <IconButton size="small" onClick={() => handleDeleteEntry(idx)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}

      {/* Auto-populate dialog */}
      <Dialog
        open={autoPopulateOpen}
        onClose={() => setAutoPopulateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Add{" "}
          {HOLIDAY_SOURCES.find((s) => s.value === autoPopulateSource)?.label}
        </DialogTitle>
        <DialogContent>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Source</InputLabel>
            <Select
              value={autoPopulateSource}
              label="Source"
              onChange={(e) => {
                setAutoPopulateSource(e.target.value);
                setAutoPopulateSelected(
                  generateHolidayTemplates(e.target.value),
                );
              }}
            >
              {HOLIDAY_SOURCES.filter((s) => s.value !== "CUSTOM").map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
            <Button
              size="small"
              onClick={() =>
                setAutoPopulateSelected(
                  generateHolidayTemplates(autoPopulateSource),
                )
              }
            >
              Select all
            </Button>
            <Button size="small" onClick={() => setAutoPopulateSelected([])}>
              Deselect all
            </Button>
          </Box>
          {generateHolidayTemplates(autoPopulateSource).map((entry, idx) => {
            const checked = autoPopulateSelected.some(
              (s) => s.date === entry.date && s.name === entry.name,
            );
            return (
              <Box
                key={idx}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  py: 0.5,
                  borderBottom: 1,
                  borderColor: "divider",
                }}
              >
                <Checkbox
                  checked={checked}
                  size="small"
                  onChange={() => {
                    if (checked) {
                      setAutoPopulateSelected(
                        autoPopulateSelected.filter(
                          (s) =>
                            !(s.date === entry.date && s.name === entry.name),
                        ),
                      );
                    } else {
                      setAutoPopulateSelected([...autoPopulateSelected, entry]);
                    }
                  }}
                />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2">{entry.name}</Typography>
                </Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 110 }}
                >
                  {formatHolidayDate(entry.date)}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 50 }}
                >
                  {/^\d{2}-\d{2}$/.test(entry.date)
                    ? entry.observance === "auto"
                      ? "Auto"
                      : "None"
                    : "—"}
                </Typography>
              </Box>
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAutoPopulateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddSelected}
            disabled={autoPopulateSelected.length === 0}
          >
            Add Selected ({autoPopulateSelected.length})
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add custom holiday dialog */}
      <Dialog
        open={addHolidayOpen}
        onClose={() => setAddHolidayOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Add Custom Holiday</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            size="small"
            fullWidth
            sx={{ mt: 1, mb: 2 }}
            value={newHolidayName}
            onChange={(e) => setNewHolidayName(e.target.value)}
          />
          <ToggleButtonGroup
            value={newHolidayType}
            exclusive
            size="small"
            onChange={(_, v) => v && setNewHolidayType(v)}
            sx={{ mb: 2 }}
          >
            <ToggleButton value="fixed">Fixed date</ToggleButton>
            <ToggleButton value="floating">
              Floating (weekday rule)
            </ToggleButton>
          </ToggleButtonGroup>

          {newHolidayType === "fixed" ? (
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel>Month</InputLabel>
                <Select
                  value={newHolidayMonth}
                  label="Month"
                  onChange={(e) => {
                    setNewHolidayMonth(Number(e.target.value));
                    setNewHolidayDay(1);
                  }}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <MenuItem key={i + 1} value={i + 1}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel>Day</InputLabel>
                <Select
                  value={newHolidayDay}
                  label="Day"
                  onChange={(e) => setNewHolidayDay(Number(e.target.value))}
                >
                  {Array.from(
                    { length: daysInMonth(newHolidayMonth) },
                    (_, i) => (
                      <MenuItem key={i + 1} value={i + 1}>
                        {i + 1}
                      </MenuItem>
                    ),
                  )}
                </Select>
              </FormControl>
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <InputLabel>Ordinal</InputLabel>
                <Select
                  value={newHolidayOrdinal}
                  label="Ordinal"
                  onChange={(e) => setNewHolidayOrdinal(e.target.value)}
                >
                  {["1st", "2nd", "3rd", "4th", "last"].map((o) => (
                    <MenuItem key={o} value={o}>
                      {o}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <InputLabel>Day</InputLabel>
                <Select
                  value={newHolidayDow}
                  label="Day"
                  onChange={(e) => setNewHolidayDow(e.target.value)}
                >
                  {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => (
                    <MenuItem key={d} value={d}>
                      {d}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="body2" sx={{ alignSelf: "center" }}>
                in
              </Typography>
              <FormControl size="small" sx={{ minWidth: 90 }}>
                <InputLabel>Month</InputLabel>
                <Select
                  value={newHolidayMonth}
                  label="Month"
                  onChange={(e) => setNewHolidayMonth(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((m, i) => (
                    <MenuItem key={i + 1} value={i + 1}>
                      {m}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          )}

          {newHolidayType === "fixed" && (
            <FormControl component="fieldset">
              <Typography variant="body2" gutterBottom>
                Observance
              </Typography>
              <RadioGroup
                value={newHolidayObservance}
                onChange={(e) =>
                  setNewHolidayObservance(e.target.value as "auto" | "none")
                }
              >
                <FormControlLabel
                  value="auto"
                  control={<Radio size="small" />}
                  label={
                    <Typography variant="body2">
                      Auto (Sat → Fri, Sun → Mon)
                    </Typography>
                  }
                />
                <FormControlLabel
                  value="none"
                  control={<Radio size="small" />}
                  label={
                    <Typography variant="body2">None (exact date)</Typography>
                  }
                />
              </RadioGroup>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddHolidayOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveNewHoliday}
            disabled={!newHolidayName.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function Schedules() {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schedule, setSchedule] = useState<any | null>(null);
  const [dialogTab, setDialogTab] = useState(0);

  const [powerwallOption, setPowerwallOption] = useState("charged");
  const [powerwallOptionValues, setPowerwallOptionValues] =
    useState<PowerwallOptionValuesType>({
      charged: 100,
      discharged: 20,
      backup: -1,
    });
  const [flowOption, setFlowOption] = useState("homeUsageAbove");
  const [flowOptionValues, setFlowOptionValues] =
    useState<FlowOptionValuesType>({
      homeUsageAbove: 8,
      homeUsageBelow: 8,
      solarGenerationAbove: 8,
      solarGenerationBelow: 8,
      gridImportAbove: 8,
      gridImportBelow: 8,
      gridExportAbove: 8,
      gridExportBelow: 8,
    });
  const [tabValid, setTabValid] = useState({
    time: false,
    powerwall: false,
    flow: false,
    actions: false,
    smart: false,
    holiday: false,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<any | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [actionValues, setActionValues] = useState<{
    [key: string]: string | number | null;
  }>({
    setBackupReserve: null,
    setSoftBackupReserve: null,
    setOperationalMode: null,
    setEnergyExports: null,
    setGridCharging: null,
    setSmartGridCharging: null,
    calibrate_grid_charge_rate: null,
    calibrate_charge_curve: null,
  });
  const [smartMode, setSmartMode] = useState<"tou" | "customDays">("tou");
  const [smartDays, setSmartDays] = useState<string[]>([]);
  const [smartWindow, setSmartWindow] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [smartSeasonalWindows, setSmartSeasonalWindows] = useState<
    SeasonalWindow[]
  >([]);
  const [tariffInfo, setTariffInfo] = useState<TariffInfo>(null);
  const theme = useTheme();
  const [availableSites, setAvailableSites] = useState<SiteWithTimezone[]>([]);
  const [holidayEntries, setHolidayEntries] = useState<HolidayEntry[]>([]);
  const [autoPopulateOpen, setAutoPopulateOpen] = useState(false);
  const [autoPopulateSource, setAutoPopulateSource] = useState("US_MAJOR");
  const [autoPopulateSelected, setAutoPopulateSelected] = useState<
    HolidayEntry[]
  >([]);
  const [addHolidayOpen, setAddHolidayOpen] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayType, setNewHolidayType] = useState<"fixed" | "floating">(
    "fixed",
  );
  const [newHolidayMonth, setNewHolidayMonth] = useState(1);
  const [newHolidayDay, setNewHolidayDay] = useState(1);
  const [newHolidayObservance, setNewHolidayObservance] = useState<
    "auto" | "none"
  >("auto");
  const [newHolidayOrdinal, setNewHolidayOrdinal] = useState("1st");
  const [newHolidayDow, setNewHolidayDow] = useState("Mon");
  const [autoPopulateToolbarSource, setAutoPopulateToolbarSource] =
    useState("US_MAJOR");

  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    axios
      .get(`/api/schedule/all`, { params: { email: user.email } })
      .then((res) => {
        setRows(res.data.data || []);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [user.email]);

  useEffect(() => {
    loadSchedules();
    axios
      .get("/api/powerwall/sites")
      .then((res) => setAvailableSites(res.data.data ?? []))
      .catch(() => setAvailableSites([]));
  }, [loadSchedules]);

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", flex: 1, minWidth: 80 },
    {
      field: "enabled",
      headerName: "",
      width: 60,
      sortable: false,
      renderCell: (params) => (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            width: "100%",
          }}
        >
          <Switch
            checked={params.row.enabled ?? true}
            size="small"
            onClick={(e) => e.stopPropagation()}
            onChange={() => handleToggleEnabled(params.row)}
          />
        </Box>
      ),
    },
    {
      field: "summary",
      headerName: "Schedule",
      flex: 3,
      minWidth: 260,
      sortable: false,
      renderCell: (params) => {
        const summary = summarizeSchedule(params.row);
        return (
          <Tooltip title={summary} placement="top">
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                height: "100%",
                width: "100%",
                overflow: "hidden",
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  color:
                    params.row.enabled === false
                      ? "text.disabled"
                      : "text.primary",
                }}
              >
                {summary}
              </Typography>
            </Box>
          </Tooltip>
        );
      },
    },
    {
      field: "site_ids",
      headerName: "Sites",
      flex: 2,
      minWidth: 150,
      valueGetter: (value: string[]) =>
        (value ?? [])
          .map((id) => availableSites.find((s) => s.id === id)?.site_name ?? id)
          .join(", "),
      renderCell: (params) => (
        <Tooltip title={params.value} placement="top">
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              height: "100%",
              width: "100%",
              overflow: "hidden",
            }}
          >
            <Typography
              variant="body2"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                width: "100%",
              }}
            >
              {params.value}
            </Typography>
          </Box>
        </Tooltip>
      ),
    },
    {
      field: "status",
      headerName: "Status",
      flex: 1,
      minWidth: 120,
      sortable: false,
      renderCell: (params) => {
        const successDate = params.row.last_success_time
          ? new Date(params.row.last_success_time)
          : null;
        const errorDate = params.row.last_error_time
          ? new Date(params.row.last_error_time)
          : null;

        let dotColor: string;
        let label: string;
        let tooltipText: string;

        if (!successDate && !errorDate) {
          dotColor = "text.disabled";
          label = "Never run";
          tooltipText = "This schedule has not run yet";
        } else if (successDate && (!errorDate || successDate > errorDate)) {
          dotColor = "success.main";
          label = timeAgo(successDate);
          tooltipText = `Last run: ${successDate.toLocaleString(undefined, { timeZoneName: "short" })}`;
        } else {
          dotColor = "error.main";
          label = timeAgo(errorDate!);
          tooltipText = `${params.row.last_error ?? "Unknown error"}\n${errorDate!.toLocaleString(undefined, { timeZoneName: "short" })}`;
        }

        return (
          <Tooltip title={tooltipText} placement="left">
            <Box display="flex" alignItems="center" height="100%" gap={0.75}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  bgcolor: dotColor,
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
            </Box>
          </Tooltip>
        );
      },
    },
    {
      field: "edit",
      headerName: "",
      width: 100,
      sortable: false,
      renderCell: (params) => {
        const getTabForSchedule = (schedule: any) => {
          if (
            (schedule?.actions ?? []).some(
              (a: any) => a.action === "setTouHolidayOverride",
            )
          )
            return 4;
          if (
            (schedule?.actions ?? []).some(
              (a: any) => a.action === "setSmartGridCharging",
            )
          )
            return 3;
          if (schedule?.conditions && Array.isArray(schedule.conditions)) {
            const condKey = schedule.conditions[0]?.condition;
            if (tabOptions.flow.some((opt) => opt.key === condKey)) return 2;
            if (tabOptions.powerwall.some((opt) => opt.key === condKey))
              return 1;
          }
          return 0;
        };
        return (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              height: "100%",
            }}
          >
            <IconButton
              onClick={(event) => {
                event.stopPropagation();
                setSchedule(params.row);
                const tab = getTabForSchedule(params.row);
                setDialogTab(tab);
                setDialogOpen(true);
                setActionValues(
                  Object.fromEntries(
                    (params.row.actions || []).map((a: any) => [
                      a.action,
                      a.value,
                    ]),
                  ),
                );
                if (tab === 4) {
                  const holidayCond = (params.row.conditions ?? []).find(
                    (c: any) => c.condition === "holidayList",
                  );
                  setHolidayEntries(
                    Array.isArray(holidayCond?.value) ? holidayCond.value : [],
                  );
                } else {
                  setHolidayEntries([]);
                }
              }}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={(event) => {
                event.stopPropagation();
                setScheduleToDelete(params.row);
                setConfirmOpen(true);
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        );
      },
    },
  ];

  const handleSaveSchedule = () => {
    setDialogOpen(false);

    const optimisticSchedule = schedule.id
      ? schedule
      : { ...schedule, id: uuidv4() };

    setRows((prevRows) => {
      const exists = prevRows.some((r) => r.id === optimisticSchedule.id);
      if (exists) {
        return prevRows.map((r) =>
          r.id === optimisticSchedule.id ? optimisticSchedule : r,
        );
      }
      return [...prevRows, optimisticSchedule];
    });

    axios
      .post("/api/schedule/upsert", schedule)
      .then(() => {
        showNotification("Schedule saved successfully", "success");
      })
      .catch((error: any) => {
        showNotification(
          error?.message || "Error saving schedule",
          "error",
          5000,
        );
      })
      .finally(() => {
        loadSchedules();
      });
  };

  const handleDeleteSchedule = () => {
    setConfirmOpen(false);
    if (!scheduleToDelete?.id) return;

    setRows((prevRows) => prevRows.filter((r) => r.id !== scheduleToDelete.id));

    axios
      .post("/api/schedule/delete", { id: scheduleToDelete.id })
      .then(() => {
        showNotification("Schedule deleted successfully", "success");
      })
      .catch((error: any) => {
        showNotification(
          error?.message || "Error deleting schedule",
          "error",
          5000,
        );
      })
      .finally(() => {
        setScheduleToDelete(null);
        loadSchedules();
      });
  };

  const handleToggleEnabled = useCallback(
    async (scheduleRow: any) => {
      const updated = { ...scheduleRow, enabled: !scheduleRow.enabled };
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      try {
        await axios.post("/api/schedule/upsert", updated);
      } catch {
        setRows((prev) =>
          prev.map((r) => (r.id === scheduleRow.id ? scheduleRow : r)),
        );
        showNotification("Failed to update schedule", "error", 5000);
      }
    },
    [showNotification],
  );

  useEffect(() => {
    setTabValid((prev) => ({
      ...prev,
      actions: Object.values(actionValues).filter((v) => v != null).length > 0,
    }));
  }, [actionValues]);

  useEffect(() => {
    if (
      (dialogTab === 1 || dialogTab === 2) &&
      schedule &&
      schedule.cron !== "* * * * *"
    ) {
      setSchedule((prev: any) => ({ ...prev, cron: "* * * * *" }));
    }
    if (dialogTab === 0 && schedule && schedule.conditions !== null) {
      setSchedule((prev: any) => ({ ...prev, conditions: null }));
    }
    if (dialogTab === 3 && schedule) {
      // For a new schedule (no smart conditions yet), apply sensible defaults.
      const hasSmartCond = (schedule.conditions ?? []).some(
        (c: any) =>
          c.condition === "inSeasonalGridChargeWindow" ||
          c.condition === "betweenHours",
      );
      if (!hasSmartCond) {
        setSchedule((prev: any) => ({
          ...prev,
          cron: "* * * * *",
          conditions: [],
        }));
      }
    }
  }, [dialogTab, schedule]);

  useEffect(() => {
    if (!schedule) return;
    if (dialogTab === 1) {
      // Powerwall tab
      setSchedule((prev: any) => ({
        ...prev,
        conditions: [
          {
            condition: powerwallOption,
            value: powerwallOptionValues[powerwallOption],
          },
        ],
      }));
    } else if (dialogTab === 2) {
      // Flow tab
      setSchedule((prev: any) => ({
        ...prev,
        conditions: [
          {
            condition: flowOption,
            value: flowOptionValues[flowOption],
          },
        ],
      }));
    } else if (dialogTab === 0) {
      // Time tab
      setSchedule((prev: any) => ({
        ...prev,
        conditions: null,
      }));
    }
    // eslint-disable-next-line
  }, [dialogTab]);

  // Keep holiday tabValid in sync with holidayEntries list.
  useEffect(() => {
    setTabValid((prev) => ({ ...prev, holiday: holidayEntries.length > 0 }));
  }, [holidayEntries]);

  // Initialize holiday UI state when opening an existing holiday schedule.
  useEffect(() => {
    if (!dialogOpen || dialogTab !== 4 || !schedule) return;
    const conditions: any[] = schedule.conditions ?? [];
    const holidayCond = conditions.find((c) => c.condition === "holidayList");
    if (Array.isArray(holidayCond?.value)) {
      setHolidayEntries(holidayCond.value as HolidayEntry[]);
    }
    // eslint-disable-next-line
  }, [dialogOpen, dialogTab]);

  // When switching to the holiday tab on a new schedule, apply fixed defaults.
  useEffect(() => {
    if (dialogTab === 4 && schedule) {
      const hasHolidayCond = (schedule.conditions ?? []).some(
        (c: any) => c.condition === "holidayList",
      );
      if (!hasHolidayCond) {
        setSchedule((prev: any) => ({
          ...prev,
          cron: "0 0 * * *",
          actions: [{ action: "setTouHolidayOverride", value: "" }],
          conditions: [{ condition: "holidayList", value: holidayEntries }],
        }));
      }
    }
    // eslint-disable-next-line
  }, [dialogTab]);

  // Keep schedule.conditions in sync with holidayEntries when on the holiday tab.
  useEffect(() => {
    if (dialogTab !== 4 || !schedule) return;
    setSchedule((prev: any) => ({
      ...prev,
      conditions: [{ condition: "holidayList", value: holidayEntries }],
    }));
    // eslint-disable-next-line
  }, [holidayEntries, dialogTab]);

  // Initialize smart UI state when opening an existing smart schedule.
  useEffect(() => {
    if (!dialogOpen || dialogTab !== 3 || !schedule) return;
    const conditions: any[] = schedule.conditions ?? [];
    const inSeasonalCond = conditions.find(
      (c) => c.condition === "inSeasonalGridChargeWindow",
    );
    const betweenHoursCond = conditions.find(
      (c) => c.condition === "betweenHours",
    );
    if (inSeasonalCond) {
      setSmartMode("tou");
      setSmartSeasonalWindows(
        Array.isArray(inSeasonalCond.value) ? inSeasonalCond.value : [],
      );
    } else if (betweenHoursCond) {
      setSmartMode("customDays");
      setSmartWindow(betweenHoursCond.value as { from: string; to: string });
      const dayPart = (schedule.cron ?? "* * * * *").split(" ")[4] ?? "*";
      if (dayPart !== "*") {
        const dowMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        setSmartDays(
          dayPart
            .split(",")
            .map((d: string) => dowMap[Number(d)])
            .filter(Boolean),
        );
      }
    }
    // eslint-disable-next-line
  }, [dialogOpen, dialogTab]);

  // Fetch tariff info when the smart tab is open and a site is selected.
  useEffect(() => {
    if (dialogTab !== 3) return;
    const siteId = schedule?.site_ids?.[0];
    if (!siteId) {
      setTariffInfo(null);
      return;
    }
    axios
      .get(`/api/powerwall/tariff-info`, { params: { siteId } })
      .then((res) => setTariffInfo(res.data.data ?? null))
      .catch(() => setTariffInfo(null));
    // eslint-disable-next-line
  }, [dialogTab, schedule?.site_ids?.[0]]);

  // Populate seasonal windows from tariff seasons (add new seasons, keep existing values).
  useEffect(() => {
    if (!tariffInfo?.seasons) return;
    setSmartSeasonalWindows((prev) => {
      const existing = new Map(prev.map((w) => [w.seasonName, w]));
      return tariffInfo.seasons.map(
        (name) => existing.get(name) ?? { seasonName: name, from: "", to: "" },
      );
    });
  }, [tariffInfo]);

  // Keep schedule.conditions in sync whenever smartSeasonalWindows changes in TOU mode.
  useEffect(() => {
    if (dialogTab !== 3 || smartMode !== "tou") return;
    setSchedule((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        conditions:
          smartSeasonalWindows.length > 0
            ? [
                {
                  condition: "inSeasonalGridChargeWindow",
                  value: smartSeasonalWindows,
                },
              ]
            : [],
      };
    });
  }, [smartSeasonalWindows, dialogTab, smartMode]);

  return (
    <Box
      sx={{
        px: { xs: 1.5, sm: 3 },
        pb: 3,
        width: "100%",
        maxWidth: 900,
        mx: "auto",
      }}
    >
      <Typography
        variant="h4"
        gutterBottom
        sx={{ display: { xs: "none", sm: "block" } }}
      >
        Schedules
      </Typography>
      <Divider sx={{ mb: 2, display: { xs: "none", sm: "block" } }} />
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="body1" color="text.secondary">
          Manage your schedules here.
        </Typography>
        <IconButton
          color="primary"
          size="medium"
          sx={{
            borderRadius: "50%",
            bgcolor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            boxShadow: 2,
            p: 1.5,
            "&:hover": { bgcolor: theme.palette.primary.dark },
          }}
          onClick={() => {
            setDialogTab(0);
            setDialogOpen(true);
            const onlineSites = availableSites.filter((s) => s.is_online);
            const firstSite = onlineSites[0];
            const tz =
              firstSite?.timezone ??
              Intl.DateTimeFormat().resolvedOptions().timeZone;
            const newSchedule = {
              email: user,
              site_ids: onlineSites.map((s) => s.id),
              cron: null,
              timezone: tz,
              enabled: true,
              expires_at: null,
              conditions: null,
              actions: null,
              options: { recovery: "none" },
            };
            setSchedule(newSchedule);
            setHolidayEntries([]);
            setPowerwallOption("charged");
            setPowerwallOptionValues({
              charged: 100,
              discharged: 20,
              backup: -1,
            });
            setFlowOption("homeUsageAbove");
            setFlowOptionValues({
              homeUsageAbove: 8,
              homeUsageBelow: 8,
              solarGenerationAbove: 8,
              solarGenerationBelow: 8,
              gridImportAbove: 8,
              gridImportBelow: 8,
              gridExportAbove: 8,
              gridExportBelow: 8,
            });
            setActionValues({
              setBackupReserve: null,
              setSoftBackupReserve: null,
              setOperationalMode: null,
              setEnergyExports: null,
              setGridCharging: null,
              setSmartGridCharging: null,
              calibrate_grid_charge_rate: null,
              calibrate_charge_curve: null,
            });
            setSmartMode("tou");
            setSmartDays([]);
            setSmartWindow({ from: "", to: "" });
            setSmartSeasonalWindows([]);
          }}
        >
          <AddIcon sx={{ fontSize: 24 }} />
        </IconButton>
      </Box>
      <Box sx={{ height: 400, width: "100%", mt: 2 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          getRowId={(row) => row.id}
          columnVisibilityModel={{
            id: false,
            site_ids: !isMobile,
            status: !isMobile,
          }}
        />
      </Box>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        slotProps={{ paper: { sx: { maxWidth: 520 } } }}
      >
        <DialogTitle>Schedule Details</DialogTitle>
        <DialogContent>
          <SiteSelector
            schedule={schedule}
            setSchedule={setSchedule}
            availableSites={availableSites}
          />
          <Tabs
            value={dialogTab}
            onChange={(_, v) => setDialogTab(v)}
            aria-label="schedule details tabs"
            variant={isMobile ? "scrollable" : "fullWidth"}
            scrollButtons="auto"
          >
            <Tab key="time" label="Time" />
            <Tab key="powerwall" label="Powerwall" />
            <Tab key="flow" label="Flow" />
            <Tab key="smart" label="Smart" />
            <Tab key="holidays" label="Holidays" />
          </Tabs>
          {dialogTab === 0 && (
            <Box mt={2}>
              <TimeSettings
                schedule={schedule}
                setSchedule={setSchedule}
                setTabValid={(valid) =>
                  setTabValid((v) => ({ ...v, time: valid }))
                }
              />
              <ActionList
                selectedAction={selectedAction}
                setSelectedAction={setSelectedAction}
                actionValues={actionValues}
                setActionValues={setActionValues}
                setSchedule={setSchedule}
              />
              <Tooltip
                title="Controls missed-run recovery. When set to 'On server restart', the schedule fires immediately on startup if a scheduled run was missed while the server was offline."
                placement="top"
                arrow
              >
                <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                  <InputLabel id="recovery-label-time">Recovery</InputLabel>
                  <Select
                    labelId="recovery-label-time"
                    value={schedule?.options?.recovery ?? "none"}
                    label="Recovery"
                    onChange={(e) =>
                      setSchedule((prev: any) => ({
                        ...prev,
                        options: { ...prev?.options, recovery: e.target.value },
                      }))
                    }
                  >
                    <MenuItem value="none">Disabled</MenuItem>
                    <MenuItem value="on_restart">On server restart</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
            </Box>
          )}
          {dialogTab === 1 && (
            <Box mt={2}>
              <PowerwallSettings
                options={tabOptions.powerwall}
                powerwallOption={powerwallOption}
                setPowerwallOption={setPowerwallOption}
                powerwallOptionValues={powerwallOptionValues}
                setPowerwallOptionValues={setPowerwallOptionValues}
                schedule={schedule}
                setSchedule={setSchedule}
                setTabValid={(valid) =>
                  setTabValid((v) => ({ ...v, powerwall: valid }))
                }
              />
              <BetweenHours schedule={schedule} setSchedule={setSchedule} />
              <ActionList
                selectedAction={selectedAction}
                setSelectedAction={setSelectedAction}
                actionValues={actionValues}
                setActionValues={setActionValues}
                setSchedule={setSchedule}
                excludeKeys={[
                  "calibrate_grid_charge_rate",
                  "calibrate_charge_curve",
                ]}
              />
            </Box>
          )}
          {dialogTab === 2 && (
            <Box mt={2}>
              <FlowSettings
                options={tabOptions.flow}
                flowOption={flowOption}
                setFlowOption={setFlowOption}
                flowOptionValues={flowOptionValues}
                setFlowOptionValues={setFlowOptionValues}
                schedule={schedule}
                setSchedule={setSchedule}
                setTabValid={(valid) =>
                  setTabValid((v) => ({ ...v, flow: valid }))
                }
              />
              <BetweenHours schedule={schedule} setSchedule={setSchedule} />
              <ActionList
                selectedAction={selectedAction}
                setSelectedAction={setSelectedAction}
                actionValues={actionValues}
                setActionValues={setActionValues}
                setSchedule={setSchedule}
                excludeKeys={[
                  "calibrate_grid_charge_rate",
                  "calibrate_charge_curve",
                ]}
              />
            </Box>
          )}
          {dialogTab === 3 && (
            <Box mt={2}>
              <SmartSettings
                schedule={schedule}
                setSchedule={setSchedule}
                setTabValid={(valid) =>
                  setTabValid((v) => ({ ...v, smart: valid }))
                }
                actionValues={actionValues}
                setSelectedAction={setSelectedAction}
                tariffInfo={tariffInfo}
                smartMode={smartMode}
                setSmartMode={setSmartMode}
                smartDays={smartDays}
                setSmartDays={setSmartDays}
                smartWindow={smartWindow}
                setSmartWindow={setSmartWindow}
                smartSeasonalWindows={smartSeasonalWindows}
                setSmartSeasonalWindows={setSmartSeasonalWindows}
              />
            </Box>
          )}
          {dialogTab === 4 && (
            <Box mt={2}>
              <HolidaysSettings
                holidayEntries={holidayEntries}
                setHolidayEntries={setHolidayEntries}
                autoPopulateOpen={autoPopulateOpen}
                setAutoPopulateOpen={setAutoPopulateOpen}
                autoPopulateSource={autoPopulateSource}
                setAutoPopulateSource={setAutoPopulateSource}
                autoPopulateSelected={autoPopulateSelected}
                setAutoPopulateSelected={setAutoPopulateSelected}
                addHolidayOpen={addHolidayOpen}
                setAddHolidayOpen={setAddHolidayOpen}
                newHolidayName={newHolidayName}
                setNewHolidayName={setNewHolidayName}
                newHolidayType={newHolidayType}
                setNewHolidayType={setNewHolidayType}
                newHolidayMonth={newHolidayMonth}
                setNewHolidayMonth={setNewHolidayMonth}
                newHolidayDay={newHolidayDay}
                setNewHolidayDay={setNewHolidayDay}
                newHolidayObservance={newHolidayObservance}
                setNewHolidayObservance={setNewHolidayObservance}
                newHolidayOrdinal={newHolidayOrdinal}
                setNewHolidayOrdinal={setNewHolidayOrdinal}
                newHolidayDow={newHolidayDow}
                setNewHolidayDow={setNewHolidayDow}
                autoPopulateToolbarSource={autoPopulateToolbarSource}
                setAutoPopulateToolbarSource={setAutoPopulateToolbarSource}
              />
              <Tooltip
                title="Controls missed-run recovery. When set to 'On server restart', the schedule fires immediately on startup if a scheduled run was missed while the server was offline."
                placement="top"
                arrow
              >
                <FormControl fullWidth size="small" sx={{ mt: 2 }}>
                  <InputLabel id="recovery-label-holidays">Recovery</InputLabel>
                  <Select
                    labelId="recovery-label-holidays"
                    value={schedule?.options?.recovery ?? "none"}
                    label="Recovery"
                    onChange={(e) =>
                      setSchedule((prev: any) => ({
                        ...prev,
                        options: { ...prev?.options, recovery: e.target.value },
                      }))
                    }
                  >
                    <MenuItem value="none">Disabled</MenuItem>
                    <MenuItem value="on_restart">On server restart</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            color="primary"
            sx={{ borderRadius: "10" }}
            disabled={
              dialogTab === 4
                ? !tabValid.holiday || !schedule?.site_ids?.length
                : dialogTab === 3
                  ? !tabValid.smart
                  : !tabValid[
                      dialogTab === 0
                        ? "time"
                        : dialogTab === 1
                          ? "powerwall"
                          : "flow"
                    ] ||
                    !tabValid.actions ||
                    !schedule?.site_ids?.length
            }
            onClick={handleSaveSchedule}
          >
            Save
          </Button>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <ActionConfigDialog
        selectedAction={selectedAction}
        setSelectedAction={setSelectedAction}
        actionValues={actionValues}
        setActionValues={setActionValues}
        setSchedule={setSchedule}
        schedule={schedule}
      />
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this schedule?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDeleteSchedule}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
