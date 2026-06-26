import { v4 as uuidv4 } from "uuid";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import {
  ALL_PERIOD_TYPES,
  PERIOD_LABELS,
  type PeriodType,
  type TouTimeBlock,
} from "~/shared/types/tou";
import type { PeriodIssue } from "~/shared/types/touValidation";

interface Props {
  periods: TouTimeBlock[];
  onChange: (periods: TouTimeBlock[]) => void;
  minutePrecision: boolean;
  periodIssues?: PeriodIssue[];
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// 48 half-hour slots: 12:00 AM … 11:30 PM
const THIRTY_MIN_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const hour = Math.floor(i / 2);
  const minute = (i % 2) * 30;
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return {
    totalMinutes: hour * 60 + minute,
    label: `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`,
  };
});

type DayPreset = "weekdays" | "weekends" | "all" | "custom";

function getDayPreset(block: TouTimeBlock): DayPreset {
  if (block.fromDayOfWeek === 0 && block.toDayOfWeek === 4) return "weekdays";
  if (block.fromDayOfWeek === 5 && block.toDayOfWeek === 6) return "weekends";
  if (block.fromDayOfWeek === 0 && block.toDayOfWeek === 6) return "all";
  return "custom";
}

function timeToHM(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTime(val: string): { hour: number; minute: number } {
  const [h, m] = val.split(":").map(Number);
  return { hour: isNaN(h) ? 0 : h, minute: isNaN(m) ? 0 : m };
}

interface TimeInputProps {
  hour: number;
  minute: number;
  minutePrecision: boolean;
  onChange: (hour: number, minute: number) => void;
  error?: boolean;
}

function TimeInput({
  hour,
  minute,
  minutePrecision,
  onChange,
  error,
}: TimeInputProps) {
  if (minutePrecision) {
    return (
      <TextField
        type="time"
        size="small"
        value={timeToHM(hour, minute)}
        slotProps={{ htmlInput: { step: 60 } }}
        onChange={(e) => {
          const parsed = parseTime(e.target.value);
          onChange(parsed.hour, parsed.minute);
        }}
        sx={{ width: 150 }}
        error={error}
      />
    );
  }

  return (
    <Select
      size="small"
      value={hour * 60 + minute}
      onChange={(e) => {
        const total = Number(e.target.value);
        onChange(Math.floor(total / 60), total % 60);
      }}
      sx={{ width: 150 }}
      error={error}
    >
      {THIRTY_MIN_SLOTS.map(({ totalMinutes, label }) => (
        <MenuItem key={totalMinutes} value={totalMinutes}>
          {label}
        </MenuItem>
      ))}
    </Select>
  );
}

function sortedForDisplay(periods: TouTimeBlock[]): TouTimeBlock[] {
  return [...periods].sort((a, b) => {
    const groupA = a.toDayOfWeek <= 4 ? 0 : 1;
    const groupB = b.toDayOfWeek <= 4 ? 0 : 1;
    if (groupA !== groupB) return groupA - groupB;
    return a.fromHour * 60 + a.fromMinute - (b.fromHour * 60 + b.fromMinute);
  });
}

export default function TouPeriodList({
  periods,
  onChange,
  minutePrecision,
  periodIssues,
}: Props) {
  const displayPeriods = sortedForDisplay(periods);

  function update(id: string, patch: Partial<TouTimeBlock>) {
    onChange(periods.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function remove(id: string) {
    onChange(periods.filter((p) => p.id !== id));
  }

  function add() {
    onChange([
      ...periods,
      {
        id: uuidv4(),
        type: "OFF_PEAK",
        fromDayOfWeek: 0,
        toDayOfWeek: 4,
        fromHour: 0,
        fromMinute: 0,
        toHour: 0,
        toMinute: 0,
      },
    ]);
  }

  function applyPreset(id: string, preset: DayPreset) {
    const patch: Partial<TouTimeBlock> =
      preset === "weekdays"
        ? { fromDayOfWeek: 0, toDayOfWeek: 4 }
        : preset === "weekends"
          ? { fromDayOfWeek: 5, toDayOfWeek: 6 }
          : preset === "all"
            ? { fromDayOfWeek: 0, toDayOfWeek: 6 }
            : {};
    update(id, patch);
  }

  return (
    <Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>From</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>To</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Days</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {displayPeriods.map((block) => {
            const preset = getDayPreset(block);
            const issue = periodIssues?.find((i) => i.periodId === block.id);
            const fromError = issue?.fields.includes("from") ?? false;
            const toError = issue?.fields.includes("to") ?? false;
            const daysError = issue?.fields.includes("days") ?? false;
            return (
              <TableRow key={block.id}>
                <TableCell sx={{ py: 0.5, minWidth: 130 }}>
                  <Select
                    size="small"
                    value={block.type}
                    onChange={(e) =>
                      update(block.id, { type: e.target.value as PeriodType })
                    }
                    sx={{ fontSize: 13 }}
                  >
                    {ALL_PERIOD_TYPES.map((t) => (
                      <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>
                        {PERIOD_LABELS[t]}
                      </MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <TimeInput
                    hour={block.fromHour}
                    minute={block.fromMinute}
                    minutePrecision={minutePrecision}
                    onChange={(h, m) =>
                      update(block.id, { fromHour: h, fromMinute: m })
                    }
                    error={fromError}
                  />
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <TimeInput
                    hour={block.toHour}
                    minute={block.toMinute}
                    minutePrecision={minutePrecision}
                    onChange={(h, m) =>
                      update(block.id, { toHour: h, toMinute: m })
                    }
                    error={toError}
                  />
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Select
                      size="small"
                      value={preset}
                      onChange={(e) =>
                        applyPreset(block.id, e.target.value as DayPreset)
                      }
                      sx={{ fontSize: 13, minWidth: 120 }}
                      error={daysError}
                    >
                      <MenuItem value="weekdays" sx={{ fontSize: 13 }}>
                        Weekdays (M–F)
                      </MenuItem>
                      <MenuItem value="weekends" sx={{ fontSize: 13 }}>
                        Weekend (Sa–Su)
                      </MenuItem>
                      <MenuItem value="all" sx={{ fontSize: 13 }}>
                        All Days
                      </MenuItem>
                      <MenuItem value="custom" sx={{ fontSize: 13 }}>
                        Custom
                      </MenuItem>
                    </Select>
                    {preset === "custom" && (
                      <>
                        <Select
                          size="small"
                          value={block.fromDayOfWeek}
                          onChange={(e) =>
                            update(block.id, {
                              fromDayOfWeek: Number(e.target.value),
                            })
                          }
                          sx={{ fontSize: 13, minWidth: 70 }}
                          error={daysError}
                        >
                          {DAY_LABELS.map((d, i) => (
                            <MenuItem key={i} value={i} sx={{ fontSize: 13 }}>
                              {d}
                            </MenuItem>
                          ))}
                        </Select>
                        <span>–</span>
                        <Select
                          size="small"
                          value={block.toDayOfWeek}
                          onChange={(e) =>
                            update(block.id, {
                              toDayOfWeek: Number(e.target.value),
                            })
                          }
                          sx={{ fontSize: 13, minWidth: 70 }}
                          error={daysError}
                        >
                          {DAY_LABELS.map((d, i) => (
                            <MenuItem key={i} value={i} sx={{ fontSize: 13 }}>
                              {d}
                            </MenuItem>
                          ))}
                        </Select>
                      </>
                    )}
                  </Box>
                </TableCell>
                <TableCell sx={{ py: 0.5 }}>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    {issue && (
                      <Tooltip title={issue.message}>
                        <ErrorOutlineIcon fontSize="small" color="error" />
                      </Tooltip>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => remove(block.id)}
                      color="error"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Box mt={1}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={add}
          variant="outlined"
        >
          Add Period
        </Button>
      </Box>
    </Box>
  );
}
