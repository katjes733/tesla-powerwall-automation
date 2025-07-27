import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useAuth } from "../auth/AuthContext";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useCallback, useEffect, useRef, useState, memo } from "react";
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
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import AddIcon from "@mui/icons-material/Add";
import { useNotification } from "../notification/NotificationContext";
import { v4 as uuidv4 } from "uuid";
import Badge from "@mui/material/Badge";
import CheckIcon from "@mui/icons-material/Check";

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
      if (!time && days.length === 0) {
        setSchedule((prev: any) => ({ ...prev, cron: null }));
      }
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

  const handleTimeOfDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTimeOfDay(e.target.value);
    setSchedule((prev: any) => {
      const cron = parseTimeAndDaysToCron(e.target.value, selectedDays);
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
          <TextField
            type="time"
            size="small"
            sx={{ width: 120, mt: 1 }}
            value={timeOfDay}
            onChange={handleTimeOfDayChange}
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
            sx={{ gap: 1, mt: 1 }}
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
  setValues: React.Dispatch<
    React.SetStateAction<PowerwallOptionValuesType | FlowOptionValuesType>
  >;
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
  [key: string]: number; // Add index signature for string keys
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
          setValues={setPowerwallOptionValues}
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
  [key: string]: number; // Add index signature for string keys
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
          setValues={setFlowOptionValues}
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
};

function ActionList({
  setSelectedAction,
  actionValues,
  setActionValues,
}: ActionProps) {
  const theme = useTheme();
  const actions = [
    {
      key: "backupReserve",
      label: "Set backup reserve",
      icon: <BatteryFullIcon />,
    },
    {
      key: "preserveCharge",
      label: "Preserve battery charge",
      icon: <BatteryFullIcon />,
    },
    {
      key: "operationalMode",
      label: "Set operational mode",
      icon: <SettingsIcon />,
    },
    { key: "energyExports", label: "Set energy exports", icon: <BoltIcon /> },
    { key: "gridCharging", label: "Set grid charging", icon: <PowerIcon /> },
  ];
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

function ActionConfigDialog({
  selectedAction,
  setSelectedAction,
  actionValues,
  setActionValues,
  setSchedule,
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
    backupReserve: {
      label: "Set Backup Reserve",
      description:
        "Backup reserve determines how much of you Powerwall's stored energy will automatically be saved for backup use. Setting it higher than the current state of charge will charge up the battery from solar or grid.",
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
    },
    preserveCharge: {
      label: "Preserve battery charge",
      description:
        "Set the Powerwall backup reserve to its current state of charge. This will avoid discharging the battery, for example when charging an EV.",
    },
    operationalMode: {
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
    energyExports: {
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
    gridCharging: {
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
    // Add configs for other actions as needed
  };
  const [tempValue, setTempValue] = useState<string | number | null>(null);
  useEffect(() => {
    if (selectedAction !== null) {
      const config = actionConfig[selectedAction];
      let initial: string | number | null = actionValues[selectedAction];
      if (initial == null) {
        if (config.options && config.options.length > 0) {
          initial = null;
        } else if (config.max !== undefined) {
          initial = config.max;
        } else {
          initial = 0;
        }
      }
      setTempValue(initial);
    } else {
      setTempValue(null);
    }
  }, [selectedAction, actionValues]);
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
            setActionValues((prev) => {
              const updated = { ...prev, [selectedAction]: tempValue };
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

export default function Schedules() {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [schedule, setSchedule] = useState<any | null>(null);
  const [dialogTab, setDialogTab] = useState(0);

  const [powerwallOption, setPowerwallOption] = useState("charged");
  const [powerwallOptionValues, setPowerwallOptionValues] = useState({
    charged: 100,
    discharged: 20,
    backup: -1,
  });
  const [flowOption, setFlowOption] = useState("homeUsageAbove");
  const [flowOptionValues, setFlowOptionValues] = useState({
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
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<any | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [actionValues, setActionValues] = useState<{
    [key: string]: string | number | null;
  }>({
    backupReserve: null,
    preserveCharge: null,
    operationalMode: null,
    energyExports: null,
    gridCharging: null,
  });
  const theme = useTheme();

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
  }, [loadSchedules]);

  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", flex: 1, minWidth: 80 },
    { field: "device_id", headerName: "Device ID", flex: 1, minWidth: 80 },
    { field: "cron", headerName: "Cron", flex: 1, minWidth: 100 },
    {
      field: "enabled",
      headerName: "Enabled",
      flex: 1,
      minWidth: 80,
      type: "boolean",
    },
    {
      field: "conditions",
      headerName: "Conditions",
      flex: 1,
      minWidth: 80,
    },
    {
      field: "actions",
      headerName: "Actions",
      flex: 1,
      minWidth: 80,
    },
    {
      field: "last_success_time",
      headerName: "Last Success",
      flex: 2,
      minWidth: 160,
      valueFormatter: (isoDateString: any) =>
        isoDateString
          ? new Date(isoDateString).toLocaleString(undefined, {
              timeZoneName: "short",
            })
          : "",
    },
    {
      field: "last_error_time",
      headerName: "Last Error",
      flex: 2,
      minWidth: 160,
      valueFormatter: (isoDateString: any) =>
        isoDateString
          ? new Date(isoDateString).toLocaleString(undefined, {
              timeZoneName: "short",
            })
          : "",
    },
    {
      field: "edit",
      headerName: "Edit",
      flex: 1,
      minWidth: 100,
      sortable: false,
      renderCell: (params) => {
        const getTabForSchedule = (schedule: any) => {
          if (schedule?.conditions && Array.isArray(schedule.conditions)) {
            const condKey = schedule.conditions[0]?.condition;
            if (tabOptions.flow.some((opt) => opt.key === condKey)) return 2; // Flow tab
            if (tabOptions.powerwall.some((opt) => opt.key === condKey))
              return 1; // Powerwall tab
          }
          return 0; // Time tab
        };
        return (
          <>
            <IconButton
              onClick={(event) => {
                event.stopPropagation();
                setSchedule(params.row);
                setDialogTab(getTabForSchedule(params.row));
                setDialogOpen(true);
                setActionValues(
                  Object.fromEntries(
                    (params.row.actions || []).map((a: any) => [
                      a.action,
                      a.value,
                    ]),
                  ),
                );
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
          </>
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
  }, [dialogTab, schedule]);

  console.log("schedule", schedule);
  // console.log("actionValues", actionValues);

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Schedules
      </Typography>
      <Divider sx={{ mb: 2 }} />
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
            const newSchedule = {
              email: user,
              device_id: "ALL",
              cron: null,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              enabled: true,
              expires_at: null,
              conditions: null,
              actions: null,
            };
            setSchedule(newSchedule);
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
              backupReserve: null,
              preserveCharge: null,
              operationalMode: null,
              energyExports: null,
              gridCharging: null,
            });
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
          columnVisibilityModel={{ id: false }}
          checkboxSelection
        />
      </Box>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="xs"
      >
        <DialogTitle>Schedule Details</DialogTitle>
        <DialogContent>
          <Tabs
            value={dialogTab}
            onChange={(_, v) => setDialogTab(v)}
            aria-label="schedule details tabs"
          >
            <Tab key="time" label="Time" />
            <Tab key="powerwall" label="Powerwall" />
            <Tab key="flow" label="Flow" />
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
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            color="primary"
            sx={{ borderRadius: "10" }}
            disabled={
              !tabValid[
                dialogTab === 0
                  ? "time"
                  : dialogTab === 1
                    ? "powerwall"
                    : "flow"
              ] || !tabValid.actions
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

// TODO: when opening an existing config (e.g. Flow) and then switching to another tab (e.g. Powerwall),
// the schedule conditions are not updated to the selected tab's conditions.
// That means, if i hit save, the new Powerwall setting is not persisted, but instead the old Flow setting is.
// As soon as I change a Powerwall condition, it works immediately as expected.
