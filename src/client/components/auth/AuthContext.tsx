import { Backdrop, Box, CircularProgress, Typography } from "@mui/material";
import axios from "axios";
import {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useNavigate } from "react-router-dom";

export const axiosInstance = axios.create({ timeout: 5000 });

interface AuthContextType {
  user: any;
  login: (username: string, password: string) => Promise<void>;
  extendSession: () => Promise<void>;
  logout: () => Promise<void>;
  newSessionId: () => void;
  loading: boolean;
  sessionExpiry: any;
  sessionId: string | null;
  setSessionExpiry: (expiry: any) => void;
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
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [sessionExpiry, setSessionExpiry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const bc = useMemo(() => {
    console.log("Creating BroadcastChannel");
    return new BroadcastChannel("auth_channel");
  }, []);

  const logoutActions = () => {
    setUser(null);
    setSessionExpiry(null);
    sessionStorage.removeItem("tabSessionId");
    sessionStorage.removeItem("chatHistory");
    setSessionId(null);
  };

  useEffect(() => {
    bc.onmessage = (event) => {
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
      console.log("Closing BroadcastChannel");
      bc.close();
    };
  }, [bc, history]);

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

  const login = useCallback(
    async (email: string, password: string) => {
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
        bc.postMessage({
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
    },
    [bc],
  );

  const extendSession = useCallback(async () => {
    setAuthPending(true);
    try {
      const response = await axiosInstance.post(
        "/api/session/extend",
        {},
        { withCredentials: true },
      );
      setSessionExpiry(response.data.sessionExpiry);
      bc.postMessage({
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
  }, [bc]);

  const logout = useCallback(async () => {
    setAuthPending(true);
    try {
      await axiosInstance.post(
        "/api/session/logout",
        {},
        { withCredentials: true },
      );
      logoutActions();
      bc.postMessage({ type: "logout" });
    } catch (error: any) {
      if (error.code === "ECONNABORTED") {
        console.error("Logout timeout exceeded");
        logoutActions();
        bc.postMessage({ type: "logout" });
      } else {
        console.error("Logout error:", error.message);
      }
    } finally {
      setAuthPending(false);
    }
  }, [bc]);

  const newSessionId = useCallback(() => {
    if (user) {
      const newSessionId = uuidv4();
      sessionStorage.setItem("tabSessionId", newSessionId);
      sessionStorage.removeItem("chatHistory");
      setSessionId(newSessionId);
    }
  }, [user]);

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
