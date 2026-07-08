import IconButton, { type IconButtonProps } from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useElementState } from "~/client/components/auth/usePermission";
import type { ActionKey } from "~/shared/permissions/schema";

interface PermissionIconButtonProps extends Omit<IconButtonProps, "disabled"> {
  permissionAction: ActionKey;
  /** Icon shown when the user has full access (or when swapToViewIcon is false). */
  icon: React.ReactNode;
  /** Icon shown instead when read-only and swapToViewIcon is true. Defaults to an eye icon. */
  viewIcon?: React.ReactNode;
  /**
   * For edit-pencil affordances specifically: when the user is read-only, swap to
   * viewIcon and keep onClick active (opens the same dialog in read-only mode)
   * instead of disabling — satisfies "Read users may open sub-dialogs to view,
   * just never change." Leave false for pure destructive/immediate actions
   * (delete, copy, apply, start), which should disable instead.
   */
  swapToViewIcon?: boolean;
  tooltip?: string;
  disabledTooltip?: string;
  /** Composes with the permission check, same as the existing disabled={...} idiom. */
  extraDisabledCondition?: boolean;
}

export default function PermissionIconButton({
  permissionAction,
  icon,
  viewIcon,
  swapToViewIcon = false,
  tooltip,
  disabledTooltip,
  extraDisabledCondition,
  onClick,
  ...iconButtonProps
}: PermissionIconButtonProps) {
  const state = useElementState(permissionAction);
  if (state === "none") return null;

  const isReadOnly = state === "read";
  const showView = swapToViewIcon && isReadOnly;
  const disabled = (isReadOnly && !swapToViewIcon) || !!extraDisabledCondition;
  const title = disabled ? (disabledTooltip ?? tooltip) : tooltip;

  const button = (
    <IconButton
      {...iconButtonProps}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
    >
      {showView
        ? (viewIcon ?? <VisibilityIcon fontSize={iconButtonProps.size} />)
        : icon}
    </IconButton>
  );

  return title ? (
    <Tooltip title={title}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
}
