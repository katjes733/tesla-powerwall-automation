import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import SeasonEditor from "./SeasonEditor";
import type { TouSeason } from "~/shared/types/tou";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Props {
  seasons: TouSeason[];
  onSeasonsChange: (seasons: TouSeason[]) => void;
}

interface NewSeasonForm {
  name: string;
  fromMonth: number;
  fromDay: number;
  toMonth: number;
  toDay: number;
}

export default function SeasonTabs({ seasons, onSeasonsChange }: Props) {
  const [activeTab, setActiveTab] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<NewSeasonForm>({
    name: "",
    fromMonth: 1,
    fromDay: 1,
    toMonth: 12,
    toDay: 31,
  });

  function updateSeason(index: number, updated: TouSeason) {
    const next = [...seasons];
    next[index] = updated;
    onSeasonsChange(next);
  }

  function removeSeason(index: number) {
    const next = seasons.filter((_, i) => i !== index);
    onSeasonsChange(next);
    setActiveTab(Math.max(0, activeTab - 1));
  }

  function addSeason() {
    if (!form.name.trim()) return;
    const newSeason: TouSeason = {
      id: uuidv4(),
      name: form.name.trim(),
      fromMonth: form.fromMonth,
      fromDay: form.fromDay,
      toMonth: form.toMonth,
      toDay: form.toDay,
      periods: [],
      rates: { buy: {}, sell: {} },
    };
    const next = [...seasons, newSeason];
    onSeasonsChange(next);
    setActiveTab(next.length - 1);
    setAddOpen(false);
    setForm({ name: "", fromMonth: 1, fromDay: 1, toMonth: 12, toDay: 31 });
  }

  if (seasons.length === 0) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        gap={2}
        py={4}
      >
        <Typography color="text.secondary">No seasons defined.</Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
        >
          Add Season
        </Button>
        <AddSeasonDialog
          open={addOpen}
          form={form}
          onFormChange={setForm}
          onCancel={() => setAddOpen(false)}
          onAdd={addSeason}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" alignItems="center">
        <Tabs
          value={Math.min(activeTab, seasons.length - 1)}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ flexGrow: 1 }}
        >
          {seasons.map((s, i) => (
            <Tab
              key={s.id}
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  <span>{s.name}</span>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSeason(i);
                    }}
                    sx={{ p: 0.25, ml: 0.25 }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              }
            />
          ))}
        </Tabs>
        <IconButton
          size="small"
          onClick={() => setAddOpen(true)}
          title="Add season"
          sx={{ ml: 1 }}
        >
          <AddIcon />
        </IconButton>
      </Box>

      {seasons.map((season, i) => (
        <Box
          key={season.id}
          role="tabpanel"
          hidden={i !== Math.min(activeTab, seasons.length - 1)}
          sx={{ pt: 2 }}
        >
          {i === Math.min(activeTab, seasons.length - 1) && (
            <SeasonEditor
              season={season}
              onChange={(updated) => updateSeason(i, updated)}
            />
          )}
        </Box>
      ))}

      <AddSeasonDialog
        open={addOpen}
        form={form}
        onFormChange={setForm}
        onCancel={() => setAddOpen(false)}
        onAdd={addSeason}
      />
    </Box>
  );
}

interface AddSeasonDialogProps {
  open: boolean;
  form: NewSeasonForm;
  onFormChange: (form: NewSeasonForm) => void;
  onCancel: () => void;
  onAdd: () => void;
}

function AddSeasonDialog({
  open,
  form,
  onFormChange,
  onCancel,
  onAdd,
}: AddSeasonDialogProps) {
  function patch(partial: Partial<NewSeasonForm>) {
    onFormChange({ ...form, ...partial });
  }

  function daysInMonth(month: number): number[] {
    const count =
      [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Add Season</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          <TextField
            label="Season Name"
            size="small"
            fullWidth
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="e.g. Summer"
          />
          <Box>
            <Typography variant="caption" color="text.secondary">
              From
            </Typography>
            <Box display="flex" gap={1} mt={0.5}>
              <Select
                size="small"
                value={form.fromMonth}
                onChange={(e) => patch({ fromMonth: Number(e.target.value) })}
                sx={{ flex: 1 }}
              >
                {MONTHS.map((m, i) => (
                  <MenuItem key={i + 1} value={i + 1}>
                    {m}
                  </MenuItem>
                ))}
              </Select>
              <Select
                size="small"
                value={form.fromDay}
                onChange={(e) => patch({ fromDay: Number(e.target.value) })}
                sx={{ minWidth: 70 }}
              >
                {daysInMonth(form.fromMonth).map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              To
            </Typography>
            <Box display="flex" gap={1} mt={0.5}>
              <Select
                size="small"
                value={form.toMonth}
                onChange={(e) => patch({ toMonth: Number(e.target.value) })}
                sx={{ flex: 1 }}
              >
                {MONTHS.map((m, i) => (
                  <MenuItem key={i + 1} value={i + 1}>
                    {m}
                  </MenuItem>
                ))}
              </Select>
              <Select
                size="small"
                value={form.toDay}
                onChange={(e) => patch({ toDay: Number(e.target.value) })}
                sx={{ minWidth: 70 }}
              >
                {daysInMonth(form.toMonth).map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          onClick={onAdd}
          disabled={!form.name.trim()}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
