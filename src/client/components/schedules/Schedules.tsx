import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import { useAuth } from "../auth/AuthContext";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useCallback, useEffect, useState } from "react";
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

export default function Schedules() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [dialogTab, setDialogTab] = useState(0);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const theme = useTheme();

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    axios
      .get(`/schedule/all`, { params: { email: user.email } })
      .then((res) => {
        setRows(res.data.data || []);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [user.email]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const handleDaysChange = (_: any, newDays: string[]) => {
    setSelectedDays(newDays);
  };

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
      field: "creation_time",
      headerName: "Created At",
      flex: 2,
      minWidth: 120,
      valueFormatter: (isoDateString: any) =>
        isoDateString
          ? new Date(isoDateString).toLocaleString(undefined, {
              timeZoneName: "short",
            })
          : "",
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Schedules
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="body1" color="text.secondary" mb={2}>
        Manage your schedules here.
      </Typography>
      <Box sx={{ height: 400, width: "100%" }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          getRowId={(row) => row.id}
          columnVisibilityModel={{ id: false }}
          checkboxSelection
          onRowClick={(params) => {
            setSelectedRow(params.row);
            setDialogOpen(true);
          }}
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
                  minHeight: 180,
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
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (day) => (
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
                      ),
                    )}
                  </ToggleButtonGroup>
                </Box>
              </Box>
              <Typography variant="subtitle1" mt={2}>
                Choose one or more actions:
              </Typography>
              <List>
                <ListItem
                  secondaryAction={
                    <IconButton edge="end" aria-label="set-backup-reserve">
                      <ChevronRightIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <BatteryFullIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary="Set backup reserve" />
                </ListItem>
                <ListItem
                  secondaryAction={
                    <IconButton edge="end" aria-label="preserve-backup-reserve">
                      <ChevronRightIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <BatteryFullIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary="Preserve battery charge" />
                </ListItem>
                <ListItem
                  secondaryAction={
                    <IconButton edge="end" aria-label="set-operational-mode">
                      <ChevronRightIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <SettingsIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary="Set operational mode" />
                </ListItem>
                <ListItem
                  secondaryAction={
                    <IconButton edge="end" aria-label="set-energy-exports">
                      <ChevronRightIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <BoltIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary="Set energy exports" />
                </ListItem>
                <ListItem
                  secondaryAction={
                    <IconButton edge="end" aria-label="set-grid-charging">
                      <ChevronRightIcon />
                    </IconButton>
                  }
                >
                  <ListItemAvatar>
                    <Avatar>
                      <PowerIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary="Set grid charging" />
                </ListItem>
              </List>
            </Box>
          )}
          {dialogTab === 1 && (
            <Box mt={2}>
              <Typography variant="subtitle1">Powerwall</Typography>
              {selectedRow && (
                <Typography>Device ID: {selectedRow.device_id}</Typography>
              )}
            </Box>
          )}
          {dialogTab === 2 && (
            <Box mt={2}>
              <Typography variant="subtitle1">Flow</Typography>
              {/* Add flow details here */}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
