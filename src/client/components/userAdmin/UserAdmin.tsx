import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Switch,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { axiosInstance } from "~/client/components/auth/AuthContext";
import { useNotification } from "~/client/components/notification/NotificationContext";
import ConfirmDialog from "~/client/components/shared/ConfirmDialog";
import PermissionButton from "~/client/components/shared/PermissionButton";
import PermissionIconButton from "~/client/components/shared/PermissionIconButton";
import type { SiteOption } from "~/client/components/shared/SiteSingleSelect";
import InviteDelegateDialog from "~/client/components/userAdmin/InviteDelegateDialog";
import DelegateEditDialog from "~/client/components/userAdmin/DelegateEditDialog";
import type { DelegationGrant } from "~/shared/schemas/delegation";

export interface Delegate extends DelegationGrant {
  delegate_email: string;
  // Whether the invitee has actually completed signup (set a password) yet —
  // a grant's own `status` is "active" from the moment it's created, so this
  // is what distinguishes "invited, awaiting signup" from genuinely active.
  signup_completed: boolean;
}

type DisplayStatus = "active" | "invited" | "revoked";

function displayStatus(delegate: Delegate): DisplayStatus {
  if (delegate.status === "revoked") return "revoked";
  if (!delegate.signup_completed) return "invited";
  return "active";
}

function statusLabel(status: DisplayStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusColor(status: DisplayStatus) {
  switch (status) {
    case "active":
      return "success";
    case "invited":
      return "warning";
    default:
      return "default";
  }
}

function siteLabel(delegate: Delegate, sites: SiteOption[]) {
  if (delegate.site_ids === "*") return "All sites";
  const names = sites
    .filter((s) => (delegate.site_ids as string[]).includes(s.id))
    .map((s) => s.site_name);
  return names.length > 0
    ? names.join(", ")
    : `${(delegate.site_ids as string[]).length} site(s)`;
}

export default function UserAdmin() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { showNotification } = useNotification();

  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Delegate | null>(null);
  const [revoking, setRevoking] = useState<Delegate | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);
  // The server always returns the account's full grant history (including
  // revoked entries) — this toggle is purely a client-side display filter,
  // off by default so the common case matches today's list exactly.
  const [showRevoked, setShowRevoked] = useState(false);

  const visibleDelegates = useMemo(
    () =>
      showRevoked ? delegates : delegates.filter((d) => d.status !== "revoked"),
    [delegates, showRevoked],
  );

  const loadDelegates = useCallback(() => {
    setLoading(true);
    axiosInstance
      .get("/api/user-admin/delegates")
      .then((res) => setDelegates(res.data.data ?? []))
      .catch(() => showNotification("Failed to load delegates", "error"))
      .finally(() => setLoading(false));
  }, [showNotification]);

  useEffect(() => {
    loadDelegates();
    axiosInstance
      .get("/api/powerwall/sites")
      .then((res) => setSites(res.data.data ?? []))
      .catch(() => setSites([]));
  }, [loadDelegates]);

  const handleRevoke = async () => {
    if (!revoking) return;
    setRevokeLoading(true);
    try {
      await axiosInstance.post("/api/user-admin/delegates/revoke", {
        delegate_email: revoking.delegate_email,
      });
      showNotification("Delegate access revoked", "success");
      setRevoking(null);
      loadDelegates();
    } catch {
      showNotification("Failed to revoke delegate", "error");
    } finally {
      setRevokeLoading(false);
    }
  };

  const columns: GridColDef[] = [
    { field: "delegate_email", headerName: "Email", flex: 1, minWidth: 200 },
    {
      field: "profile",
      headerName: "Permission",
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          sx={{ textTransform: "capitalize" }}
        />
      ),
    },
    {
      field: "site_ids",
      headerName: "Sites",
      flex: 1,
      minWidth: 160,
      renderCell: (params) => siteLabel(params.row as Delegate, sites),
    },
    {
      field: "status",
      headerName: "Status",
      width: 110,
      renderCell: (params) => {
        const status = displayStatus(params.row as Delegate);
        return (
          <Chip
            label={statusLabel(status)}
            size="small"
            color={statusColor(status)}
          />
        );
      },
    },
    {
      field: "actions",
      headerName: "",
      width: 100,
      sortable: false,
      align: "right",
      renderCell: (params) => {
        const row = params.row as Delegate;
        // Revoked entries are shown only for audit purposes — there's
        // nothing left to edit or revoke on a grant that's already revoked.
        if (row.status === "revoked") return null;
        return (
          <Box display="flex" gap={0.5}>
            <PermissionIconButton
              permissionAction="userAdmin.update"
              icon={<EditIcon fontSize="small" />}
              tooltip="Edit"
              size="small"
              onClick={() => setEditing(row)}
            />
            <PermissionIconButton
              permissionAction="userAdmin.revoke"
              icon={<DeleteIcon fontSize="small" />}
              tooltip="Revoke access"
              size="small"
              color="error"
              onClick={() => setRevoking(row)}
            />
          </Box>
        );
      },
    },
  ];

  return (
    <Box px={3} pb={3} display="flex" flexDirection="column" gap={2}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography variant="h5">User Admin</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage who can access this Tesla account and at what permission
            level.
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={2}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showRevoked}
                onChange={(e) => setShowRevoked(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                Show revoked
              </Typography>
            }
          />
          <PermissionButton
            permissionAction="userAdmin.invite"
            variant="contained"
            onClick={() => setInviteOpen(true)}
          >
            Invite Delegate
          </PermissionButton>
        </Box>
      </Box>

      {isMobile ? (
        <Paper variant="outlined">
          <List disablePadding>
            {visibleDelegates.map((delegate) => (
              <ListItem
                key={delegate.delegate_email}
                divider
                secondaryAction={
                  delegate.status === "revoked" ? undefined : (
                    <Box display="flex" gap={0.5}>
                      <PermissionIconButton
                        permissionAction="userAdmin.update"
                        icon={<EditIcon fontSize="small" />}
                        tooltip="Edit"
                        size="small"
                        onClick={() => setEditing(delegate)}
                      />
                      <PermissionIconButton
                        permissionAction="userAdmin.revoke"
                        icon={<DeleteIcon fontSize="small" />}
                        tooltip="Revoke access"
                        size="small"
                        color="error"
                        onClick={() => setRevoking(delegate)}
                      />
                    </Box>
                  )
                }
              >
                <ListItemText
                  primary={delegate.delegate_email}
                  slotProps={{ secondary: { component: "div" } }}
                  secondary={
                    <>
                      <Chip
                        label={delegate.profile}
                        size="small"
                        sx={{ textTransform: "capitalize", mr: 1 }}
                      />
                      <Chip
                        label={statusLabel(displayStatus(delegate))}
                        size="small"
                        color={statusColor(displayStatus(delegate))}
                      />
                      <Typography
                        variant="caption"
                        display="block"
                        sx={{ mt: 0.5 }}
                      >
                        {siteLabel(delegate, sites)}
                      </Typography>
                    </>
                  }
                />
              </ListItem>
            ))}
            {visibleDelegates.length === 0 && !loading && (
              <ListItem>
                <ListItemText primary="No delegates yet" />
              </ListItem>
            )}
          </List>
        </Paper>
      ) : (
        <Box sx={{ height: 480 }}>
          <DataGrid
            rows={visibleDelegates}
            columns={columns}
            getRowId={(row) => row.delegate_email}
            loading={loading}
            disableRowSelectionOnClick
            hideFooterSelectedRowCount
          />
        </Box>
      )}

      <InviteDelegateDialog
        open={inviteOpen}
        sites={sites}
        onClose={() => setInviteOpen(false)}
        onInvited={() => {
          setInviteOpen(false);
          loadDelegates();
        }}
      />

      <DelegateEditDialog
        open={!!editing}
        delegate={editing}
        sites={sites}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          loadDelegates();
        }}
      />

      <ConfirmDialog
        open={!!revoking}
        title={`Revoke access for ${revoking?.delegate_email}?`}
        description="They will immediately lose access to this Tesla account."
        confirmLabel="Revoke"
        confirmColor="error"
        confirmLoading={revokeLoading}
        onCancel={() => setRevoking(null)}
        onConfirm={handleRevoke}
      />
    </Box>
  );
}
