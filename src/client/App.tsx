import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import NavMenu from "./components/layout/NavMenu";
import MainContainer from "./components/layout/MainContainer";
import Footer from "./components/layout/Footer";
import { Route, Navigate, Routes, type RouteProps } from "react-router-dom";
import { type ComponentType } from "react";
import { AuthProvider, useAuth } from "./components/auth/AuthContext";
import HealthCards from "./components/health/Health";
import Login from "./components/auth/Login";
import { NotificationProvider } from "./components/notification/NotificationContext";
import Schedules from "./components/schedules/Schedules";
import PowerwallStatus from "./components/powerwall/PowerwallStatus";
import TouConfigs from "./components/tou/TouConfigs";
import ManualSettings from "./components/manualSettings/ManualSettings";
import Calibration from "./components/calibration/Calibration";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AuthRedirect = () => {
  const { user } = useAuth();
  return <Navigate to={user ? "/" : "/login"} replace />;
};

function App() {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? "dark" : "light",
    },
  });

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <NotificationProvider>
            <NavMenu />
            <MainContainer>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <PowerwallStatus />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/health"
                  element={
                    <ProtectedRoute>
                      <HealthCards />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/schedules"
                  element={
                    <ProtectedRoute>
                      <Schedules />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tou-configs"
                  element={
                    <ProtectedRoute>
                      <TouConfigs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <ManualSettings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/calibration"
                  element={
                    <ProtectedRoute>
                      <Calibration />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<AuthRedirect />} />
              </Routes>
            </MainContainer>
            <Footer />
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </LocalizationProvider>
  );
}

export default App;
