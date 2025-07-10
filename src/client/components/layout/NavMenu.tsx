import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { Avatar, Divider, Menu, MenuItem, IconButton } from "@mui/material";
import AppsIcon from "@mui/icons-material/Apps";
import logo from "../../assets/logo.png";
import { useAuth } from "../auth/AuthContext";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function NavMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
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
      <Toolbar sx={{ minHeight: 64, px: 2 }}>
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
                <MenuItem onClick={handleMainMenuClose}>
                  Left Menu Item 1
                </MenuItem>
                <MenuItem onClick={handleMainMenuClose}>
                  Left Menu Item 2
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
          <img
            src={logo}
            alt="Tesla Powerwall Automation Logo"
            style={{ height: 64, width: "auto", flexShrink: 0 }}
          />
          <Box sx={{ minWidth: 0, overflow: "hidden" }}>
            <Typography variant="h5" component="div" fontWeight={600} noWrap>
              Tesla Powerwall Automation
            </Typography>
            <Typography variant="subtitle1" component="div" noWrap>
              Scheduled energy management using the Tesla Fleet API
            </Typography>
          </Box>
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
                sx={{ cursor: "pointer" }}
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
