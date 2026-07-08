import Button, { type ButtonProps } from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import { useElementState } from "~/client/components/auth/usePermission";
import type { ActionKey } from "~/shared/permissions/schema";

interface PermissionButtonProps extends ButtonProps {
  permissionAction: ActionKey;
  disabledTooltip?: string;
}

// "none" -> not rendered, "read" -> disabled (with tooltip), "write" -> enabled.
// Composes with existing business-logic `disabled` conditions rather than
// replacing them: <PermissionButton permissionAction="calibration.gridChargeRate.start"
// disabled={jobRunning} .../>.
export default function PermissionButton({
  permissionAction,
  disabledTooltip,
  disabled,
  ...rest
}: PermissionButtonProps) {
  const state = useElementState(permissionAction);
  if (state === "none") return null;

  const isDisabled = disabled || state === "read";
  const button = <Button {...rest} disabled={isDisabled} />;

  return isDisabled && disabledTooltip ? (
    <Tooltip title={disabledTooltip}>
      <span>{button}</span>
    </Tooltip>
  ) : (
    button
  );
}
