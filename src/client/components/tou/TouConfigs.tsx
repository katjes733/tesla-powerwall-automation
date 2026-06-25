import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import AddIcon from "@mui/icons-material/Add";
import PublishIcon from "@mui/icons-material/Publish";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import TouEditorDialog from "./TouEditorDialog";
import {
  tariffV2ToEditorState,
  editorStateToTariffV2,
  emptyEditorState,
  type TouEditorState,
} from "~/shared/types/tou";
import type { ITouScheduleConfig } from "~/server/database/models/touScheduleConfig";
import SiteSingleSelect, { type SiteOption } from "../shared/SiteSingleSelect";

interface PendingApply {
  config: ITouScheduleConfig;
  siteName: string;
}

export default function TouConfigs() {
  const { showNotification } = useNotification();

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [configs, setConfigs] = useState<ITouScheduleConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [loadingTesla, setLoadingTesla] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorState, setEditorState] =
    useState<TouEditorState>(emptyEditorState());
  const [scheduleName, setScheduleName] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // true while the editor holds an unmodified snapshot loaded from Tesla
  const [isUnmodifiedTeslaImport, setIsUnmodifiedTeslaImport] = useState(false);

  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [applying, setApplying] = useState(false);
  const [autoBackup, setAutoBackup] = useState(
    () => localStorage.getItem("tou-auto-backup") === "true",
  );

  function toggleAutoBackup(enabled: boolean) {
    setAutoBackup(enabled);
    localStorage.setItem("tou-auto-backup", String(enabled));
  }

  useEffect(() => {
    axiosInstance
      .get<{ success: boolean; data: SiteOption[] }>("/api/powerwall/sites")
      .then((r) => {
        const data = r.data.data ?? [];
        setSites(data);
        const first = data.find((s) => s.is_online) ?? data[0];
        if (first) setSelectedSiteId(first.id);
      })
      .catch(() => showNotification("Failed to load sites", "error"));
  }, []);

  const loadConfigs = useCallback(() => {
    if (!selectedSiteId) return;
    setLoadingConfigs(true);
    axiosInstance
      .get<{ success: boolean; data: ITouScheduleConfig[] }>(
        `/api/tou-config/list?siteId=${selectedSiteId}`,
      )
      .then((r) => setConfigs(r.data.data ?? []))
      .catch(() => showNotification("Failed to load TOU configs", "error"))
      .finally(() => setLoadingConfigs(false));
  }, [selectedSiteId]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  function openNewEditor() {
    setEditingId(undefined);
    setScheduleName("");
    setEditorState(emptyEditorState());
    setIsUnmodifiedTeslaImport(false);
    setEditorOpen(true);
  }

  function openEditEditor(row: ITouScheduleConfig) {
    setEditingId(row.id);
    setScheduleName(row.schedule_name);
    setEditorState(tariffV2ToEditorState(row.schedule_config));
    setIsUnmodifiedTeslaImport(false);
    setEditorOpen(true);
  }

  async function loadFromTesla() {
    if (!selectedSiteId) return;
    setLoadingTesla(true);
    try {
      const r = await axiosInstance.get<{
        success: boolean;
        data: { tariff_content_v2: Record<string, unknown> };
      }>(`/api/tou-config/current?siteId=${selectedSiteId}`);
      const state = tariffV2ToEditorState(r.data.data.tariff_content_v2);
      const date = new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const defaultName = state.tariffName
        ? `${state.tariffName} – ${date}`
        : `From Tesla – ${date}`;
      setEditingId(undefined);
      setScheduleName(defaultName);
      setEditorState(state);
      setIsUnmodifiedTeslaImport(true);
      setEditorOpen(true);
    } catch {
      showNotification("Failed to load current Tesla schedule", "error");
    } finally {
      setLoadingTesla(false);
    }
  }

  function handleEditorChange(state: TouEditorState) {
    setIsUnmodifiedTeslaImport(false);
    setEditorState(state);
  }

  async function handleSave() {
    if (!scheduleName.trim() || !selectedSiteId) return;
    setSaving(true);
    try {
      const schedule_config = editorStateToTariffV2(editorState);
      await axiosInstance.post("/api/tou-config/save", {
        id: editingId,
        schedule_name: scheduleName.trim(),
        site_id: selectedSiteId,
        schedule_config,
        mark_active: isUnmodifiedTeslaImport,
      });
      showNotification("Config saved", "success");
      setEditorOpen(false);
      loadConfigs();
    } catch {
      showNotification("Failed to save config", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await axiosInstance.post("/api/tou-config/delete", { id });
      showNotification("Config deleted", "success");
      loadConfigs();
    } catch {
      showNotification("Failed to delete config", "error");
    }
  }

  async function confirmApply(withBackup: boolean) {
    if (!pendingApply || !selectedSiteId) return;
    setApplying(true);
    try {
      await axiosInstance.post("/api/tou-config/apply", {
        id: pendingApply.config.id,
        site_id: selectedSiteId,
        backup: withBackup,
      });
      showNotification("Schedule applied to Tesla successfully", "success");
      setPendingApply(null);
      loadConfigs();
    } catch {
      showNotification("Failed to apply schedule to Tesla", "error");
    } finally {
      setApplying(false);
    }
  }

  const columns: GridColDef[] = [
    {
      field: "schedule_name",
      headerName: "Name",
      flex: 1,
      minWidth: 160,
    },
    {
      field: "modified_time",
      headerName: "Modified",
      width: 180,
      valueGetter: (value: string) =>
        value ? new Date(value).toLocaleString() : "",
    },
    {
      field: "is_active",
      headerName: "Active",
      width: 70,
      sortable: false,
      align: "center",
      headerAlign: "center",
      renderCell: (params) =>
        params.value ? (
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            height="100%"
          >
            <CheckCircleIcon color="success" fontSize="small" />
          </Box>
        ) : null,
    },
    {
      field: "actions",
      headerName: "",
      width: 116,
      sortable: false,
      align: "right",
      renderCell: (params) => (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="flex-end"
          height="100%"
          gap={0.5}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openEditEditor(params.row as ITouScheduleConfig);
            }}
            title="Edit"
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <Tooltip title="Apply to Tesla">
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => {
                e.stopPropagation();
                const site = sites.find((s) => s.id === selectedSiteId);
                setPendingApply({
                  config: params.row as ITouScheduleConfig,
                  siteName: site?.site_name ?? selectedSiteId,
                });
              }}
            >
              <PublishIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(params.row.id);
            }}
            title="Delete"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    },
  ];

  return (
    <Box p={3} display="flex" flexDirection="column" gap={2}>
      <Typography variant="h5">TOU Schedule Configs</Typography>

      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <SiteSingleSelect
          sites={sites}
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          sx={{ minWidth: 280 }}
        />
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={openNewEditor}
          disabled={!selectedSiteId}
        >
          New Config
        </Button>
        <Button
          variant="outlined"
          startIcon={
            loadingTesla ? (
              <CircularProgress size={16} />
            ) : (
              <CloudDownloadIcon />
            )
          }
          onClick={loadFromTesla}
          disabled={!selectedSiteId || loadingTesla}
        >
          Load from Tesla
        </Button>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autoBackup}
              onChange={(e) => toggleAutoBackup(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              Auto-backup on apply
            </Typography>
          }
          sx={{ ml: "auto", mr: 0 }}
        />
      </Box>

      {/* Config list */}
      <Box sx={{ height: 500 }}>
        <DataGrid
          rows={configs}
          columns={columns}
          loading={loadingConfigs}
          pageSizeOptions={[25, 50, 100]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          disableRowSelectionOnClick
        />
      </Box>

      {/* Editor dialog */}
      <TouEditorDialog
        open={editorOpen}
        state={editorState}
        scheduleName={scheduleName}
        onScheduleNameChange={setScheduleName}
        onChange={handleEditorChange}
        onSave={handleSave}
        onClose={() => setEditorOpen(false)}
        saving={saving}
      />

      {/* Apply confirmation dialog */}
      <Dialog
        open={!!pendingApply}
        onClose={() => setPendingApply(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Apply Schedule to Tesla?</DialogTitle>
        <DialogContent>
          <Typography>
            Apply <strong>{pendingApply?.config.schedule_name}</strong> to{" "}
            <strong>{pendingApply?.siteName}</strong>?
          </Typography>
          {autoBackup ? (
            <Typography variant="body2" color="text.secondary" mt={1}>
              The current Tesla schedule will be automatically backed up before
              applying.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" mt={1}>
              No backup will be created. Use &ldquo;Backup &amp; Confirm&rdquo;
              to save a backup of the current schedule before applying.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingApply(null)} disabled={applying}>
            Cancel
          </Button>
          {!autoBackup && (
            <Button
              variant="outlined"
              onClick={() => confirmApply(true)}
              disabled={applying}
            >
              {applying ? "Applying…" : "Backup & Confirm"}
            </Button>
          )}
          <Button
            variant="contained"
            color="primary"
            onClick={() => confirmApply(autoBackup)}
            disabled={applying}
          >
            {applying ? "Applying…" : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
