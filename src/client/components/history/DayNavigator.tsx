import { useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import RefreshIcon from "@mui/icons-material/Refresh";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import dayjs, { type Dayjs } from "dayjs";

interface Props {
  date: Dayjs;
  isToday: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
  onDateChange: (date: Dayjs) => void;
  onRefresh: () => void;
  showRefresh?: boolean;
}

export default function DayNavigator({
  date,
  isToday,
  loading,
  onPrev,
  onNext,
  onDateChange,
  onRefresh,
  showRefresh = true,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Box display="flex" alignItems="center" gap={0.5}>
      <IconButton onClick={onPrev} disabled={loading} size="small">
        <ChevronLeftIcon />
      </IconButton>

      <DatePicker
        open={pickerOpen}
        onOpen={() => setPickerOpen(true)}
        onClose={() => setPickerOpen(false)}
        value={date}
        maxDate={dayjs()}
        onChange={(newDate) => {
          if (newDate) onDateChange(newDate);
        }}
        slotProps={{
          textField: {
            size: "small",
            onClick: () => setPickerOpen(true),
            sx: {
              width: 148,
              cursor: "pointer",
              "& input": { cursor: "pointer" },
            },
          },
        }}
      />

      <IconButton onClick={onNext} disabled={isToday || loading} size="small">
        <ChevronRightIcon />
      </IconButton>

      {isToday && showRefresh && (
        <IconButton
          onClick={onRefresh}
          disabled={loading}
          size="small"
          title="Refresh today's data"
        >
          <RefreshIcon />
        </IconButton>
      )}
    </Box>
  );
}
