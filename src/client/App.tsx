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
import EnergyHistory from "./components/history/EnergyHistory";
import Maintenance from "./components/maintenance/Maintenance";
import UserAdmin from "./components/userAdmin/UserAdmin";
import type { ActionKey } from "~/shared/permissions/schema";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requiredAction: ActionKey;
};

// requiredAction is required (not optional) — every route passes one, even the
// pages that just reuse their domain's own .access key, so there's no "some
// routes check, some don't" special-casing.
const ProtectedRoute = ({ children, requiredAction }: ProtectedRouteProps) => {
  const { user, loading, getElementState } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  // Hasn't completed Tesla OAuth yet — the only page they're allowed to reach
  // is Maintenance, where they can actually link their account.
  if (!user.accountLinked && requiredAction !== "maintenance.access")
    return <Navigate to="/maintenance" replace />;
  if (getElementState(requiredAction) === "none")
    return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AuthRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.accountLinked ? "/" : "/maintenance"} replace />;
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
                    <ProtectedRoute requiredAction="powerwall.access">
                      <PowerwallStatus />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/health"
                  element={
                    <ProtectedRoute requiredAction="health.access">
                      <HealthCards />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/schedules"
                  element={
                    <ProtectedRoute requiredAction="schedule.access">
                      <Schedules />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tou-configs"
                  element={
                    <ProtectedRoute requiredAction="touConfig.access">
                      <TouConfigs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute requiredAction="siteSettings.access">
                      <ManualSettings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/calibration"
                  element={
                    <ProtectedRoute requiredAction="calibration.access">
                      <Calibration />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/history"
                  element={
                    <ProtectedRoute requiredAction="powerwall.access">
                      <EnergyHistory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/maintenance"
                  element={
                    <ProtectedRoute requiredAction="maintenance.access">
                      <Maintenance />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/user-admin"
                  element={
                    <ProtectedRoute requiredAction="userAdmin.access">
                      <UserAdmin />
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
