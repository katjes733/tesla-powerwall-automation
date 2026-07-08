import { useState } from "react";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { axiosInstance } from "~/client/components/auth/AuthContext";
import { useNotification } from "~/client/components/notification/NotificationContext";
import SiteMultiSelect from "~/client/components/shared/SiteMultiSelect";
import type { SiteOption } from "~/client/components/shared/SiteSingleSelect";
import { PROFILE_NAMES, type ProfileName } from "~/shared/permissions/profile";

interface Props {
  open: boolean;
  sites: SiteOption[];
  onClose: () => void;
  onInvited: () => void;
}

export default function InviteDelegateDialog({
  open,
  sites,
  onClose,
  onInvited,
}: Props) {
  const { showNotification } = useNotification();
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileName>("read");
  const [siteIds, setSiteIds] = useState<string[] | "*">("*");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setEmail("");
    setProfile("read");
    setSiteIds("*");
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await axiosInstance.post("/api/user-admin/delegates/invite", {
        delegate_email: email.trim(),
        profile,
        site_ids: siteIds,
      });
      showNotification("Invite sent", "success");
      reset();
      onInvited();
    } catch (error: any) {
      showNotification(
        error.response?.data?.message || "Failed to send invite",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const isValidEmail = /\S+@\S+\.\S+/.test(email);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Invite Delegate</DialogTitle>
      <DialogContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
      >
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          autoFocus
        />
        <FormControl fullWidth size="small">
          <InputLabel id="invite-profile-label">Permission Level</InputLabel>
          <Select
            labelId="invite-profile-label"
            label="Permission Level"
            value={profile}
            onChange={(e) => setProfile(e.target.value as ProfileName)}
          >
            {PROFILE_NAMES.map((p) => (
              <MenuItem key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <SiteMultiSelect
          sites={sites}
          value={siteIds}
          onChange={setSiteIds}
          fullWidth
        />
        <Typography variant="body2" color="text.secondary">
          An email invitation will be sent to this address to set up their
          account.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !isValidEmail}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Send Invite
        </Button>
      </DialogActions>
    </Dialog>
  );
}
