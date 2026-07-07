import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { Avatar, Divider, Menu, MenuItem, IconButton } from "@mui/material";
import AppsIcon from "@mui/icons-material/Apps";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

import { useAuth } from "../auth/AuthContext";
import { useCallback, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const PAGE_TITLES: Record<string, string> = {
  "/": "Powerwall",
  "/health": "App Health",
  "/schedules": "Schedules",
  "/tou-configs": "TOU Configs",
  "/settings": "Manual Settings",
  "/calibration": "Calibration",
  "/history": "Energy History",
  "/maintenance": "Maintenance",
};

export default function NavMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useTheme();
  const pageTitle = PAGE_TITLES[location.pathname] ?? "";
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mainMenuAnchor, setMainMenuAnchor] = useState<null | HTMLElement>(
    null,
  );
  const avatarRef = useRef<HTMLDivElement>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setAnchorEl(null);
    avatarRef.current?.focus();
  };

  const handleMainMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMainMenuAnchor(event.currentTarget);
  };

  const handleMainMenuClose = () => {
    setMainMenuAnchor(null);
  };

  const handleLogout = useCallback(async () => {
    handleUserMenuClose();
    logout()
      .then(() => {
        navigate("/login");
      })
      .catch((error: any) => {
        console.error("Logout failed:", error);
      });
  }, [handleUserMenuClose, logout, navigate]);

  const handleNavigateToPowerwall = useCallback(() => {
    handleMainMenuClose();
    navigate("/");
  }, [navigate]);

  const handleNavigateToHealth = useCallback(() => {
    handleMainMenuClose();
    navigate("/health");
  }, [navigate]);

  const handleNavigateToSchedules = useCallback(() => {
    handleMainMenuClose();
    navigate("/schedules");
  }, [navigate]);

  const handleNavigateToTouConfigs = useCallback(() => {
    handleMainMenuClose();
    navigate("/tou-configs");
  }, [navigate]);

  const handleNavigateToSettings = useCallback(() => {
    handleMainMenuClose();
    navigate("/settings");
  }, [navigate]);

  const handleNavigateToCalibration = useCallback(() => {
    handleMainMenuClose();
    navigate("/calibration");
  }, [navigate]);

  const handleNavigateToHistory = useCallback(() => {
    handleMainMenuClose();
    navigate("/history");
  }, [navigate]);

  const handleNavigateToMaintenance = useCallback(() => {
    handleMainMenuClose();
    navigate("/maintenance");
  }, [navigate]);

  return (
    <AppBar
      position="fixed"
      color="primary"
      enableColorOnDark
      sx={{
        width: "100%",
        bgcolor: "background.paper",
        color: "text.primary",
        boxShadow: 1,
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 48, sm: 64 }, px: 2 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 1,
            flexGrow: 0,
          }}
        >
          {user && (
            <>
              <IconButton
                edge="start"
                color="inherit"
                aria-label="menu"
                onClick={handleMainMenuOpen}
                sx={{ mr: 1 }}
              >
                <AppsIcon />
              </IconButton>
              <Menu
                anchorEl={mainMenuAnchor}
                open={Boolean(mainMenuAnchor)}
                onClose={handleMainMenuClose}
              >
                <MenuItem onClick={handleNavigateToPowerwall}>
                  Powerwall
                </MenuItem>
                <MenuItem onClick={handleNavigateToHealth}>App Health</MenuItem>
                <MenuItem onClick={handleNavigateToSchedules}>
                  Schedules
                </MenuItem>
                <MenuItem onClick={handleNavigateToTouConfigs}>
                  TOU Configs
                </MenuItem>
                <MenuItem onClick={handleNavigateToSettings}>
                  Manual Settings
                </MenuItem>
                <MenuItem onClick={handleNavigateToCalibration}>
                  Calibration
                </MenuItem>
                <MenuItem onClick={handleNavigateToHistory}>
                  Energy History
                </MenuItem>
                <MenuItem onClick={handleNavigateToMaintenance}>
                  Maintenance
                </MenuItem>
              </Menu>
            </>
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexDirection: "row",
            flexGrow: 1,
            minWidth: 0,
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {isMobile ? (
            <Typography variant="h6" component="div" fontWeight={600} noWrap>
              {pageTitle}
            </Typography>
          ) : (
            <>
              <img
                src="/logo.png"
                alt="Tesla Powerwall Automation Logo"
                style={{ height: 64, width: "auto", flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0, overflow: "hidden" }}>
                <Typography
                  variant="h5"
                  component="div"
                  fontWeight={600}
                  noWrap
                >
                  Tesla Powerwall Automation
                </Typography>
                <Typography variant="subtitle1" component="div" noWrap>
                  Scheduled energy management using the Tesla Fleet API
                </Typography>
              </Box>
            </>
          )}
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexShrink: 1,
            flexGrow: 0,
            justifyContent: "flex-end",
          }}
        >
          {user && (
            <>
              <Avatar
                ref={avatarRef}
                onClick={handleUserMenuOpen}
                tabIndex={0}
                sx={{
                  cursor: "pointer",
                  width: { xs: 32, sm: 40 },
                  height: { xs: 32, sm: 40 },
                }}
              />
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={handleUserMenuClose}
              >
                <MenuItem
                  disableRipple
                  disableTouchRipple
                  tabIndex={-1}
                  sx={{ pointerEvents: "none" }}
                >
                  {user}
                </MenuItem>
                <Divider />
                <MenuItem onClick={handleLogout}>Logout</MenuItem>
              </Menu>
            </>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
