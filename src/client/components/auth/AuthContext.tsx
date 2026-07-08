import { Backdrop, Box, CircularProgress, Typography } from "@mui/material";
import axios from "axios";
import {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "react-router-dom";
import { getElementState } from "~/shared/permissions/profile";
import type { AccessLevel, ActionKey } from "~/shared/permissions/schema";
import type { ProfileName } from "~/shared/permissions/profile";

export const axiosInstance = axios.create({ timeout: 5000 });

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

interface AuthContextType {
  user: SessionUser | null;
  login: (username: string, password: string) => Promise<void>;
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
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => {},
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
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionExpiry, setSessionExpiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const bcRef = useRef<BroadcastChannel | null>(null);

  const logoutActions = () => {
    setUser(null);
    setSessionExpiry(null);
    sessionStorage.removeItem("tabSessionId");
    sessionStorage.removeItem("chatHistory");
    setSessionId(null);
  };

  useEffect(() => {
    const channel = new BroadcastChannel("auth_channel");
    bcRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data) {
        const { type, sessionExpiry: newExpiry } = event.data;
        if (type === "logout") {
          logoutActions();
          if (window.location.pathname !== "/login") {
            navigate("/login");
          }
        } else if (type === "login") {
          axiosInstance
            .get("/api/session/me", { withCredentials: true })
            .then((response) => {
              setUser(response.data.user);
              setSessionExpiry(response.data.sessionExpiry);
              if (window.location.pathname !== "/") {
                navigate("/");
              }
            })
            .catch(() => {
              setUser(null);
              setSessionExpiry(null);
            });
        } else if (type === "extend-session") {
          setSessionExpiry(newExpiry);
        }
      }
    };

    return () => {
      channel.close();
      bcRef.current = null;
    };
  }, [navigate]);

  useEffect(() => {
    const interceptor = axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (
          error.response?.status === 401 &&
          !error.config?.url?.includes("/api/session/") &&
          window.location.pathname !== "/login"
        ) {
          logoutActions();
          navigate("/login");
        }
        return Promise.reject(error);
      },
    );
    return () => axiosInstance.interceptors.response.eject(interceptor);
  }, [navigate]);

  useEffect(() => {
    axiosInstance
      .get("/api/session/me", { withCredentials: true })
      .then((response) => {
        setUser(response.data.user);
        if (response.data.sessionExpiry) {
          setSessionExpiry(response.data.sessionExpiry);
        }
      })
      .catch(() => {
        setUser(null);
        setSessionExpiry(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(
      () => {
        axiosInstance
          .get("/api/session/me", { withCredentials: true })
          .then((response) => {
            if (response.data.sessionExpiry) {
              setSessionExpiry(response.data.sessionExpiry);
            }
          })
          .catch((error) => {
            if (error.response?.status === 401) {
              logoutActions();
              if (window.location.pathname !== "/login") navigate("/login");
            }
          });
      },
      2 * 60 * 1000,
    );
    return () => clearInterval(interval);
  }, [user, navigate]);

  useEffect(() => {
    if (!sessionExpiry) return;
    const msUntilExpiry = sessionExpiry - Date.now();
    if (msUntilExpiry <= 0) {
      logoutActions();
      if (window.location.pathname !== "/login") navigate("/login");
      return;
    }
    const timer = setTimeout(() => {
      logoutActions();
      bcRef.current?.postMessage({ type: "logout" });
      if (window.location.pathname !== "/login") navigate("/login");
    }, msUntilExpiry);
    return () => clearTimeout(timer);
  }, [sessionExpiry, navigate]);

  useEffect(() => {
    if (!loading) {
      if (user) {
        let storedSessionId = sessionStorage.getItem("tabSessionId");
        if (!storedSessionId) {
          storedSessionId = uuidv4();
          sessionStorage.setItem("tabSessionId", storedSessionId);
        }
        setSessionId(storedSessionId);
      } else {
        sessionStorage.removeItem("tabSessionId");
        setSessionId(null);
      }
    }
  }, [loading, user]);

  const login = useCallback(async (email: string, password: string) => {
    setAuthPending(true);
    try {
      const response = await axiosInstance.post(
        "/api/session/login",
        { email, password },
        { withCredentials: true },
      );
      setUser(response.data.user);
      setSessionExpiry(response.data.sessionExpiry);
      const newSessionId = uuidv4();
      sessionStorage.setItem("tabSessionId", newSessionId);
      setSessionId(newSessionId);
      bcRef.current?.postMessage({
        type: "login",
        sessionExpiry: response.data.sessionExpiry,
      });
    } catch (error: any) {
      console.error(
        "Login error:",
        error.response?.data?.message || error.message,
      );
      throw error;
    } finally {
      setAuthPending(false);
    }
  }, []);

  const extendSession = useCallback(async () => {
    setAuthPending(true);
    try {
      const response = await axiosInstance.post(
        "/api/session/extend",
        {},
        { withCredentials: true },
      );
      setSessionExpiry(response.data.sessionExpiry);
      bcRef.current?.postMessage({
        type: "extend-session",
        sessionExpiry: response.data.sessionExpiry,
      });
    } catch (error: any) {
      console.error(
        "Error extending session:",
        error.response?.data?.message || error.message,
      );
      throw error;
    } finally {
      setAuthPending(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthPending(true);
    try {
      await axiosInstance.post(
        "/api/session/logout",
        {},
        { withCredentials: true },
      );
      logoutActions();
      bcRef.current?.postMessage({ type: "logout" });
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        console.error("Logout timeout exceeded");
        logoutActions();
        bcRef.current?.postMessage({ type: "logout" });
      } else {
        console.error("Logout error:", error.message);
      }
    } finally {
      setAuthPending(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 60 * 60 * 1000;
    const THROTTLE_MS = 60_000;
    const EVENTS = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ] as const;

    let timer: ReturnType<typeof setTimeout>;
    let lastActivity = performance.now();

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => logout(), IDLE_MS);
    };

    const onActivity = () => {
      const now = performance.now();
      if (now - lastActivity > THROTTLE_MS) {
        lastActivity = now;
        resetTimer();
      }
    };

    EVENTS.forEach((e) =>
      document.addEventListener(e, onActivity, { passive: true }),
    );
    resetTimer();

    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => document.removeEventListener(e, onActivity));
    };
  }, [user, logout]);

  const newSessionId = useCallback(() => {
    if (user) {
      const newSessionId = uuidv4();
      sessionStorage.setItem("tabSessionId", newSessionId);
      sessionStorage.removeItem("chatHistory");
      setSessionId(newSessionId);
    }
  }, [user]);

  const getElementStateForUser = useCallback(
    (action: ActionKey): AccessLevel =>
      user ? getElementState(user.profile, action) : "none",
    [user],
  );

  const hasSiteAccess = useCallback(
    (siteId: string | null | undefined): boolean => {
      if (!user || !siteId) return false;
      return user.siteIds === "*" || user.siteIds.includes(siteId);
    },
    [user],
  );

  const isAdmin = useMemo(() => user?.profile === "admin", [user]);

  return (
    <>
      <AuthContext.Provider
        value={{
          user,
          login,
          extendSession,
          logout,
          newSessionId,
          loading,
          sessionExpiry,
          sessionId,
          setSessionExpiry,
          getElementState: getElementStateForUser,
          hasSiteAccess,
          isAdmin,
        }}
      >
        {children}
      </AuthContext.Provider>
      {authPending && (
        <Backdrop open={authPending} sx={{ position: "absolute" }}>
          <Box display="flex" flexDirection="column" alignItems="center">
            <CircularProgress color="info" />
            <Typography variant="body2" sx={{ marginTop: 2 }}>
              Loading...
            </Typography>
          </Box>
        </Backdrop>
      )}
    </>
  );
};

export const useAuth = () => useContext(AuthContext);
