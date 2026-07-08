import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
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
}

function statusColor(status: Delegate["status"]) {
  return status === "active" ? "success" : "default";
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
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={statusColor(params.value)}
        />
      ),
    },
    {
      field: "actions",
      headerName: "",
      width: 100,
      sortable: false,
      align: "right",
      renderCell: (params) => {
        const row = params.row as Delegate;
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
        <PermissionButton
          permissionAction="userAdmin.invite"
          variant="contained"
          onClick={() => setInviteOpen(true)}
        >
          Invite Delegate
        </PermissionButton>
      </Box>

      {isMobile ? (
        <Paper variant="outlined">
          <List disablePadding>
            {delegates.map((delegate) => (
              <ListItem
                key={delegate.delegate_email}
                divider
                secondaryAction={
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
                }
              >
                <ListItemText
                  primary={delegate.delegate_email}
                  secondary={
                    <>
                      <Chip
                        label={delegate.profile}
                        size="small"
                        sx={{ textTransform: "capitalize", mr: 1 }}
                      />
                      <Chip
                        label={delegate.status}
                        size="small"
                        color={statusColor(delegate.status)}
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
            {delegates.length === 0 && !loading && (
              <ListItem>
                <ListItemText primary="No delegates yet" />
              </ListItem>
            )}
          </List>
        </Paper>
      ) : (
        <Box sx={{ height: 480 }}>
          <DataGrid
            rows={delegates}
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
