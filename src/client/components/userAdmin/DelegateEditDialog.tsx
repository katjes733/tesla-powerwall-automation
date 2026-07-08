import { useEffect, useState } from "react";
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
} from "@mui/material";
import { axiosInstance } from "~/client/components/auth/AuthContext";
import { useNotification } from "~/client/components/notification/NotificationContext";
import SiteMultiSelect from "~/client/components/shared/SiteMultiSelect";
import type { SiteOption } from "~/client/components/shared/SiteSingleSelect";
import { PROFILE_NAMES, type ProfileName } from "~/shared/permissions/profile";
import type { Delegate } from "~/client/components/userAdmin/UserAdmin";

interface Props {
  open: boolean;
  delegate: Delegate | null;
  sites: SiteOption[];
  onClose: () => void;
  onSaved: () => void;
}

export default function DelegateEditDialog({
  open,
  delegate,
  sites,
  onClose,
  onSaved,
}: Props) {
  const { showNotification } = useNotification();
  const [profile, setProfile] = useState<ProfileName>("read");
  const [siteIds, setSiteIds] = useState<string[] | "*">("*");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (delegate) {
      setProfile(delegate.profile);
      setSiteIds(delegate.site_ids);
    }
  }, [delegate]);

  const handleSubmit = async () => {
    if (!delegate) return;
    setSaving(true);
    try {
      await axiosInstance.post("/api/user-admin/delegates/update", {
        delegate_email: delegate.delegate_email,
        profile,
        site_ids: siteIds,
      });
      showNotification("Delegate updated", "success");
      onSaved();
    } catch (error: any) {
      showNotification(
        error.response?.data?.message || "Failed to update delegate",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Edit Delegate</DialogTitle>
      <DialogContent
        sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
      >
        <TextField
          label="Email"
          value={delegate?.delegate_email ?? ""}
          disabled
          fullWidth
        />
        <FormControl fullWidth size="small">
          <InputLabel id="edit-profile-label">Permission Level</InputLabel>
          <Select
            labelId="edit-profile-label"
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
