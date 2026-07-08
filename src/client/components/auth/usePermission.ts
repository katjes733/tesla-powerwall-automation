import { useAuth } from "~/client/components/auth/AuthContext";
import type { AccessLevel, ActionKey } from "~/shared/permissions/schema";

// The single source every gated component reads from — "none" (hidden),
// "read" (visible, disabled), or "write" (visible, enabled). There is no
// separate boolean hasPermission; components branch on the three states.
export function useElementState(action: ActionKey): AccessLevel {
  const { getElementState } = useAuth();
  return getElementState(action);
}

export function useSiteAccess(siteId: string | null | undefined): boolean {
  const { hasSiteAccess } = useAuth();
  return hasSiteAccess(siteId);
}

export function useIsAdmin(): boolean {
  return useAuth().isAdmin;
}
