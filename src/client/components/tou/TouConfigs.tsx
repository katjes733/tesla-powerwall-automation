import { useState, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import Divider from "@mui/material/Divider";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import AddIcon from "@mui/icons-material/Add";
import PublishIcon from "@mui/icons-material/Publish";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { axiosInstance } from "../auth/AuthContext";
import { useNotification } from "../notification/NotificationContext";
import TouEditorDialog from "./TouEditorDialog";
import ConfirmDialog from "../shared/ConfirmDialog";
import {
  tariffV2ToEditorState,
  editorStateToTariffV2,
  emptyEditorState,
  type TouEditorState,
} from "~/shared/types/tou";
import type { ITouScheduleConfig } from "~/server/database/models/touScheduleConfig";
import SiteSingleSelect, { type SiteOption } from "../shared/SiteSingleSelect";
import SwipeToDeleteRow from "../shared/SwipeToDeleteRow";

interface PendingApply {
  config: ITouScheduleConfig;
  siteName: string;
}

interface RowActionsProps {
  onApply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function RowActions({ onApply, onEdit, onCopy, onDelete }: RowActionsProps) {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="flex-end"
      height="100%"
      gap={0.5}
    >
      <Tooltip title="Apply to Tesla">
        <IconButton
          size="small"
          color="primary"
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
        >
          <PublishIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Divider
        orientation="vertical"
        sx={{ height: 18, mx: 0.5, borderRightWidth: 2 }}
      />
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit"
      >
        <EditIcon fontSize="small" />
      </IconButton>
      <Tooltip title="Copy config">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <IconButton
        size="small"
        color="error"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

export default function TouConfigs() {
  const { showNotification } = useNotification();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

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
  const [openSwipeRow, setOpenSwipeRow] = useState<string | null>(null);
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

  async function handleCopy(row: ITouScheduleConfig) {
    const existingNames = new Set(configs.map((c) => c.schedule_name));
    const base = `${row.schedule_name} - copy`;
    let newName = base;
    if (existingNames.has(newName)) {
      let i = 2;
      while (existingNames.has(`${base} (${i})`)) i++;
      newName = `${base} (${i})`;
    }
    try {
      await axiosInstance.post("/api/tou-config/save", {
        schedule_name: newName,
        site_id: selectedSiteId,
        schedule_config: row.schedule_config,
      });
      showNotification(`Copied as "${newName}"`, "success");
      loadConfigs();
    } catch {
      showNotification("Failed to copy config", "error");
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
      minWidth: isMobile ? 120 : 160,
      renderCell: (params) => (
        <Box
          display="flex"
          alignItems="center"
          gap={1}
          height="100%"
          sx={{ minWidth: 0 }}
        >
          {isMobile && params.row.is_active && (
            <CheckCircleIcon
              color="success"
              fontSize="small"
              sx={{ flexShrink: 0 }}
            />
          )}
          <Typography variant="body2" noWrap>
            {params.row.schedule_name}
          </Typography>
        </Box>
      ),
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
      width: 160,
      sortable: false,
      align: "right",
      renderCell: (params) => {
        const row = params.row as ITouScheduleConfig;
        const site = sites.find((s) => s.id === selectedSiteId);
        return (
          <RowActions
            onApply={() =>
              setPendingApply({
                config: row,
                siteName: site?.site_name ?? selectedSiteId,
              })
            }
            onEdit={() => openEditEditor(row)}
            onCopy={() => handleCopy(row)}
            onDelete={() => handleDelete(row.id)}
          />
        );
      },
    },
  ];

  return (
    <Box px={3} pb={3} display="flex" flexDirection="column" gap={2}>
      <Typography variant="h5" sx={{ display: { xs: "none", sm: "block" } }}>
        TOU Schedule Configs
      </Typography>

      {/* Toolbar */}
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <SiteSingleSelect
          sites={sites}
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          sx={{
            minWidth: { xs: 0, sm: 280 },
            width: { xs: "100%", sm: "auto" },
          }}
        />
        {isMobile ? (
          <Box display="flex" gap={1}>
            <Tooltip title="New Config">
              <span>
                <IconButton
                  onClick={openNewEditor}
                  disabled={!selectedSiteId}
                  color="primary"
                >
                  <AddIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Load from Tesla">
              <span>
                <IconButton
                  onClick={loadFromTesla}
                  disabled={!selectedSiteId || loadingTesla}
                  color="primary"
                >
                  {loadingTesla ? (
                    <CircularProgress size={20} />
                  ) : (
                    <CloudDownloadIcon />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ) : (
          <Box display="flex" gap={1}>
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
          </Box>
        )}
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
          sx={{ ml: { xs: 0, sm: "auto" }, mr: 0 }}
        />
      </Box>

      {/* Config list */}
      {isMobile ? (
        <Box
          sx={{
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          {loadingConfigs ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : configs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No configs saved for this site.
            </Typography>
          ) : (
            configs.map((config) => {
              const site = sites.find((s) => s.id === selectedSiteId);
              return (
                <SwipeToDeleteRow
                  key={config.id}
                  isOpen={openSwipeRow === config.id}
                  onOpen={() => setOpenSwipeRow(config.id)}
                  onClose={() => setOpenSwipeRow(null)}
                  onDelete={() => handleDelete(config.id)}
                >
                  <Box
                    display="flex"
                    alignItems="center"
                    px={2}
                    py={1.5}
                    gap={1}
                  >
                    <Box
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      {config.is_active && (
                        <CheckCircleIcon
                          color="success"
                          fontSize="small"
                          sx={{ flexShrink: 0 }}
                        />
                      )}
                      <Typography variant="body2" noWrap>
                        {config.schedule_name}
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      <Tooltip title="Apply to Tesla">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() =>
                            setPendingApply({
                              config,
                              siteName: site?.site_name ?? selectedSiteId,
                            })
                          }
                        >
                          <PublishIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        size="small"
                        onClick={() => openEditEditor(config)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <Tooltip title="Copy config">
                        <IconButton
                          size="small"
                          onClick={() => handleCopy(config)}
                        >
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                </SwipeToDeleteRow>
              );
            })
          )}
        </Box>
      ) : (
        <Box sx={{ height: 500 }}>
          <DataGrid
            rows={configs}
            columns={columns}
            loading={loadingConfigs}
            pageSizeOptions={[25, 50, 100]}
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
            disableRowSelectionOnClick
            sx={{
              "& .MuiDataGrid-cell[data-field='actions']": {
                overflow: "visible",
                paddingLeft: "6px",
                paddingRight: "6px",
              },
            }}
          />
        </Box>
      )}

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
        nameExists={configs.some(
          (c) => c.schedule_name === scheduleName.trim() && c.id !== editingId,
        )}
      />

      {/* Apply confirmation dialog */}
      <ConfirmDialog
        open={!!pendingApply}
        onCancel={() => setPendingApply(null)}
        title="Apply Schedule to Tesla?"
        description={
          <>
            <Typography>
              Apply <strong>{pendingApply?.config.schedule_name}</strong> to{" "}
              <strong>{pendingApply?.siteName}</strong>?
            </Typography>
            {autoBackup ? (
              <Typography variant="body2" color="text.secondary" mt={1}>
                The current Tesla schedule will be automatically backed up
                before applying.
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary" mt={1}>
                No backup will be created. Use &ldquo;Backup &amp;
                Confirm&rdquo; to save a backup of the current schedule before
                applying.
              </Typography>
            )}
          </>
        }
        secondaryAction={
          autoBackup
            ? undefined
            : { label: "Backup & Confirm", onClick: () => confirmApply(true) }
        }
        onConfirm={() => confirmApply(autoBackup)}
        confirmLabel="Confirm"
        confirmLoading={applying}
        maxWidth="xs"
        fullWidth
      />
    </Box>
  );
}
