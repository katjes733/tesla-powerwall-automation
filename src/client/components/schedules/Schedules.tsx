import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useAuth } from "../auth/AuthContext";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useCallback, useEffect, useRef, useState } from "react";
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

type TimeSettingsProps = {
  schedule: any;
  setSchedule: (row: any) => void;
  setTabValid: (valid: boolean) => void;
};

function parseCronToTimeAndDays(cron: string) {
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
  }, [schedule]);

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

type DynamicSettingsProps = {
  options: Array<{
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    step: number;
  }>;
  selectedOption: string;
  setSelectedOption: (value: string) => void;
  values: Record<string, number>;
  setValues: React.Dispatch<
    React.SetStateAction<PowerwallOptionValuesType | FlowOptionValuesType>
  >;
  extraSetting?: React.ReactNode;
};

function DynamicSettings({
  options,
  selectedOption,
  setSelectedOption,
  values,
  setValues,
  extraSetting,
}: DynamicSettingsProps) {
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
          <Box display="flex" flexDirection="column" gap={1}>
            <Slider
              value={values[opt.key]}
              onChange={(_, v) =>
                setValues((prev) => ({ ...prev, [opt.key]: v as number }))
              }
              min={opt.min}
              max={opt.max}
              step={opt.step}
              sx={{ width: "100%" }}
              disabled={selectedOption !== opt.key}
            />
            <TextField
              value={values[opt.key]}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [opt.key]: Number(e.target.value),
                }))
              }
              type="number"
              inputProps={{ min: opt.min, max: opt.max, step: opt.step }}
              size="small"
              sx={{ width: 100 }}
              disabled={selectedOption !== opt.key}
              InputProps={{ endAdornment: <Typography>{opt.unit}</Typography> }}
            />
          </Box>
        </Box>
      ))}
      {extraSetting}
    </RadioGroup>
  );
}

type PowerwallOptionValuesType = {
  charged: number;
  discharged: number;
  backup: number;
};

type PowerwallSettingsProps = {
  powerwallOption: string;
  setPowerwallOption: (value: string) => void;
  powerwallOptionValues: PowerwallOptionValuesType;
  setPowerwallOptionValues: React.Dispatch<
    React.SetStateAction<PowerwallOptionValuesType>
  >;
};

function PowerwallSettings({
  powerwallOption,
  setPowerwallOption,
  powerwallOptionValues,
  setPowerwallOptionValues,
}: PowerwallSettingsProps) {
  const theme = useTheme();
  const options = [
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
  ];
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
          extraSetting={
            <FormControlLabel
              value="backup"
              control={<Radio />}
              label={<Typography>Discharged down to backup reserve</Typography>}
              sx={{ mt: 2 }}
            />
          }
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
};

type FlowSettingsProps = {
  flowOption: string;
  setFlowOption: (value: string) => void;
  flowOptionValues: FlowOptionValuesType;
  setFlowOptionValues: React.Dispatch<
    React.SetStateAction<FlowOptionValuesType>
  >;
};

function FlowSettings({
  flowOption,
  setFlowOption,
  flowOptionValues,
  setFlowOptionValues,
}: FlowSettingsProps) {
  const theme = useTheme();
  const options = [
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
  ];

  const handleValueChange = (key: string, value: number) => {
    setFlowOptionValues((prev) => ({ ...prev, [key]: value }));
  };

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
        />
      </Box>
    </>
  );
}

function ActionList() {
  const theme = useTheme();
  return (
    <>
      <Typography variant="subtitle1" mt={2}>
        Choose one or more actions:
      </Typography>
      <List>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
        >
          <ListItemAvatar>
            <Avatar>
              <BatteryFullIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Set backup reserve" />
        </ListItem>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
        >
          <ListItemAvatar>
            <Avatar>
              <BatteryFullIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Preserve battery charge" />
        </ListItem>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
        >
          <ListItemAvatar>
            <Avatar>
              <SettingsIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Set operational mode" />
        </ListItem>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
        >
          <ListItemAvatar>
            <Avatar>
              <BoltIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Set energy exports" />
        </ListItem>
        <ListItem
          component="button"
          secondaryAction={<ChevronRightIcon />}
          sx={{ bgcolor: theme.palette.action.hover, borderRadius: 2, mb: 1 }}
        >
          <ListItemAvatar>
            <Avatar>
              <PowerIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Set grid charging" />
        </ListItem>
      </List>
    </>
  );
}

function BetweenHours() {
  const theme = useTheme();
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
        <TextField type="time" size="small" sx={{ width: 120, mt: 1 }} />
        <Typography variant="body2">and</Typography>
        <TextField type="time" size="small" sx={{ width: 120, mt: 1 }} />
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
    backup: 20,
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
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<any | null>(null);
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
      field: "configuration",
      headerName: "Configuration",
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
      field: "actions",
      headerName: "Actions",
      flex: 1,
      minWidth: 100,
      sortable: false,
      renderCell: (params) => (
        <>
          <IconButton
            onClick={(event) => {
              event.stopPropagation();
              setSchedule(params.row);
              setDialogTab(isFixedTime(params.row.cron) ? 0 : 1);
              setDialogOpen(true);
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
      ),
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
            setSchedule({
              email: user,
              device_id: "ALL",
              cron: null,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              enabled: true,
              expires_at: null,
              configuration: [{}],
            });
            setPowerwallOption("charged");
            setPowerwallOptionValues({
              charged: 100,
              discharged: 20,
              backup: 20,
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
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Schedule Details</DialogTitle>
        <DialogContent>
          <Tabs
            value={dialogTab}
            onChange={(_, v) => setDialogTab(v)}
            aria-label="schedule details tabs"
          >
            <Tab label="Time" />
            <Tab label="Powerwall" />
            <Tab label="Flow" />
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
              <ActionList />
            </Box>
          )}
          {dialogTab === 1 && (
            <Box mt={2}>
              <PowerwallSettings
                powerwallOption={powerwallOption}
                setPowerwallOption={setPowerwallOption}
                powerwallOptionValues={powerwallOptionValues}
                setPowerwallOptionValues={setPowerwallOptionValues}
              />
              <BetweenHours />
              <ActionList />
            </Box>
          )}
          {dialogTab === 2 && (
            <Box mt={2}>
              <FlowSettings
                flowOption={flowOption}
                setFlowOption={setFlowOption}
                flowOptionValues={flowOptionValues}
                setFlowOptionValues={setFlowOptionValues}
              />
              <BetweenHours />
              <ActionList />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            color="primary"
            sx={{ borderRadius: 10 }}
            disabled={
              !tabValid[
                dialogTab === 0
                  ? "time"
                  : dialogTab === 1
                    ? "powerwall"
                    : "flow"
              ]
            }
            onClick={handleSaveSchedule}
          >
            Save
          </Button>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
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
