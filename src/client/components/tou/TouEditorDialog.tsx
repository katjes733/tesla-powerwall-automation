import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SeasonTabs from "./SeasonTabs";
import type { TouEditorState } from "~/shared/types/tou";

interface Props {
  open: boolean;
  state: TouEditorState;
  scheduleName: string;
  onScheduleNameChange: (name: string) => void;
  onChange: (state: TouEditorState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function TouEditorDialog({
  open,
  state,
  scheduleName,
  onScheduleNameChange,
  onChange,
  onSave,
  onClose,
  saving,
}: Props) {
  function patch(partial: Partial<TouEditorState>) {
    onChange({ ...state, ...partial });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>TOU Schedule Editor</DialogTitle>
      <DialogContent dividers>
        <Box display="flex" flexDirection="column" gap={3}>
          {/* Config name + tariff metadata */}
          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              label="Config Name"
              size="small"
              value={scheduleName}
              onChange={(e) => onScheduleNameChange(e.target.value)}
              sx={{ minWidth: 200, flex: 1 }}
              helperText="How this config is saved in the list"
            />
            <TextField
              label="Tariff Name"
              size="small"
              value={state.tariffName}
              onChange={(e) => patch({ tariffName: e.target.value })}
              sx={{ minWidth: 160, flex: 1 }}
              helperText="e.g. E27"
            />
            <TextField
              label="Utility"
              size="small"
              value={state.utility}
              onChange={(e) => patch({ utility: e.target.value })}
              sx={{ minWidth: 140, flex: 1 }}
              helperText="e.g. SRP"
            />
          </Box>

          {/* Seasons */}
          <Box>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Seasons
            </Typography>
            <SeasonTabs
              seasons={state.seasons}
              onSeasonsChange={(seasons) => patch({ seasons })}
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving || !scheduleName.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
