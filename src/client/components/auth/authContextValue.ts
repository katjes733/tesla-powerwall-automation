import { createContext } from "react";
import type { AccessLevel, ActionKey } from "~/shared/permissions/schema";
import type { ProfileName } from "~/shared/permissions/profile";

export interface SessionUser {
  loginEmail: string;
  teslaAccountEmail: string;
  accountType: "owner" | "delegate";
  profile: ProfileName;
  siteIds: string[] | "*";
  // False for a brand-new self-signup owner who hasn't completed Tesla OAuth
  // yet — App.tsx/NavMenu restrict them to the Maintenance page until they do.
  accountLinked: boolean;
}

export interface AuthContextType {
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithPasskey: (opts?: {
    silent?: boolean;
    autofill?: boolean;
  }) => Promise<void>;
  registerPasskey: (nickname?: string) => Promise<void>;
  extendSession: () => Promise<void>;
  logout: () => Promise<void>;
  newSessionId: () => void;
  loading: boolean;
  sessionExpiry: any;
  sessionId: string | null;
  setSessionExpiry: (expiry: any) => void;
  getElementState: (action: ActionKey) => AccessLevel;
  hasSiteAccess: (siteId: string | null | undefined) => boolean;
  isAdmin: boolean;
  passkeyPromptOpen: boolean;
  closePasskeyPrompt: () => void;
  dismissPasskeyPromptPermanently: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => {},
  loginWithPasskey: async () => {},
  registerPasskey: async () => {},
  extendSession: async () => {},
  logout: async () => {},
  newSessionId: () => {},
  loading: false,
  sessionExpiry: null,
  sessionId: null,
  setSessionExpiry: () => {},
  getElementState: () => "none",
  hasSiteAccess: () => false,
  isAdmin: false,
  passkeyPromptOpen: false,
  closePasskeyPrompt: () => {},
  dismissPasskeyPromptPermanently: () => {},
});
