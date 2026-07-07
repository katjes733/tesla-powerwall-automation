import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  type ButtonProps,
  type DialogProps,
} from "@mui/material";
import type { ReactNode } from "react";

interface ConfirmDialogAction {
  label: string;
  onClick: () => void;
  color?: ButtonProps["color"];
  variant?: ButtonProps["variant"];
  disabled?: boolean;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmColor?: ButtonProps["color"];
  confirmLoading?: boolean;
  secondaryAction?: ConfirmDialogAction;
  maxWidth?: DialogProps["maxWidth"];
  fullWidth?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  confirmColor = "primary",
  confirmLoading = false,
  secondaryAction,
  maxWidth,
  fullWidth,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {typeof description === "string" ? (
          <DialogContentText>{description}</DialogContentText>
        ) : (
          description
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={confirmLoading}>
          {cancelLabel}
        </Button>
        {secondaryAction && (
          <Button
            onClick={secondaryAction.onClick}
            color={secondaryAction.color}
            variant={secondaryAction.variant ?? "outlined"}
            disabled={secondaryAction.disabled || confirmLoading}
          >
            {secondaryAction.label}
          </Button>
        )}
        <Button
          onClick={onConfirm}
          color={confirmColor}
          variant="contained"
          disabled={confirmLoading}
          startIcon={
            confirmLoading ? <CircularProgress size={16} /> : undefined
          }
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
