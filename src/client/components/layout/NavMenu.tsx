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
import type { ActionKey } from "~/shared/permissions/schema";

interface NavItem {
  path: string;
  label: string;
  action: ActionKey;
}

// One array drives both the page title lookup, the nav menu's visibility, and
// (via App.tsx's route table using the same action keys) the route gates — so
// nav and routes can't drift apart.
const NAV_ITEMS: NavItem[] = [
  { path: "/", label: "Powerwall", action: "powerwall.access" },
  { path: "/health", label: "App Health", action: "health.access" },
  { path: "/schedules", label: "Schedules", action: "schedule.access" },
  { path: "/tou-configs", label: "TOU Configs", action: "touConfig.access" },
  {
    path: "/settings",
    label: "Manual Settings",
    action: "siteSettings.access",
  },
  { path: "/calibration", label: "Calibration", action: "calibration.access" },
  { path: "/history", label: "Energy History", action: "powerwall.access" },
  { path: "/maintenance", label: "Maintenance", action: "maintenance.access" },
  { path: "/user-admin", label: "User Admin", action: "userAdmin.access" },
];

const PAGE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.path, item.label]),
);

export default function NavMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, getElementState } = useAuth();
  const theme = useTheme();
  const pageTitle = PAGE_TITLES[location.pathname] ?? "";
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [mainMenuAnchor, setMainMenuAnchor] = useState<null | HTMLElement>(
    null,
  );
  const avatarRef = useRef<HTMLDivElement>(null);

  // Hasn't completed Tesla OAuth yet — only Maintenance (where they can link
  // their account) is reachable, regardless of what their admin profile would
  // otherwise unlock.
  const visibleNavItems =
    user && !user.accountLinked
      ? NAV_ITEMS.filter((item) => item.path === "/maintenance")
      : NAV_ITEMS.filter((item) => getElementState(item.action) !== "none");

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

  const handleNavigate = useCallback(
    (path: string) => {
      handleMainMenuClose();
      navigate(path);
    },
    [navigate],
  );

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
                {visibleNavItems.map((item) => (
                  <MenuItem
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                  >
                    {item.label}
                  </MenuItem>
                ))}
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
                  sx={{
                    pointerEvents: "none",
                    flexDirection: "column",
                    alignItems: "flex-start",
                  }}
                >
                  <Typography variant="body2">{user?.loginEmail}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user?.profile}{" "}
                    {user?.accountType === "delegate" &&
                      `· Managing ${user.teslaAccountEmail}`}
                  </Typography>
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
