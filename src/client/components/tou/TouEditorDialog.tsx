import { useState, useMemo } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
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
import {
  validateEditorState,
  formatValidationErrors,
  formatMonthIssues,
} from "~/shared/types/touValidation";

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
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const validation = useMemo(() => validateEditorState(state), [state]);
  const validationErrors = useMemo(
    () => formatValidationErrors(validation, state),
    [validation, state],
  );
  const monthIssues = useMemo(
    () => formatMonthIssues(validation, state),
    [validation, state],
  );

  function patch(partial: Partial<TouEditorState>) {
    onChange({ ...state, ...partial });
  }

  function handleSaveClick() {
    if (validation.hasErrors) {
      setShowValidationErrors(true);
    } else {
      onSave();
    }
  }

  function handleClose() {
    setShowValidationErrors(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
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
            {monthIssues.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {monthIssues.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </Box>
              </Alert>
            )}
            <SeasonTabs
              seasons={state.seasons}
              onSeasonsChange={(seasons) => patch({ seasons })}
            />
          </Box>

          {showValidationErrors && validation.hasErrors && (
            <Alert
              severity="error"
              onClose={() => setShowValidationErrors(false)}
            >
              <AlertTitle>
                Cannot save — fix the following issues first
              </AlertTitle>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </Box>
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        {showValidationErrors && validation.hasErrors && (
          <Button
            variant="outlined"
            color="warning"
            onClick={onSave}
            disabled={saving}
          >
            Save Anyway
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleSaveClick}
          disabled={saving || !scheduleName.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
