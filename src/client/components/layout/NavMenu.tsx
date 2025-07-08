import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { Avatar, Divider, Menu, MenuItem } from "@mui/material";
import logo from "../../assets/logo.png";
import { useAuth } from "../auth/AuthContext";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function NavMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    avatarRef.current?.focus();
  };

  const handleLogout = useCallback(async () => {
    handleMenuClose();
    logout()
      .then(() => {
        navigate("/login");
      })
      .catch((error: any) => {
        console.error("Logout failed:", error);
      });
  }, [handleMenuClose, logout, navigate]);

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
      <Toolbar sx={{ justifyContent: "center", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <img
            src={logo}
            alt="Tesla Powerwall Automation Logo"
            style={{ height: 64, width: "auto" }}
          />
          <Box>
            <Typography variant="h5" component="div" fontWeight={600}>
              Tesla Powerwall Automation
            </Typography>
            <Typography variant="subtitle1" component="div">
              Scheduled energy management using the Tesla Fleet API
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {user && (
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Avatar
              ref={avatarRef}
              onClick={handleMenuOpen}
              tabIndex={0}
              sx={{ cursor: "pointer" }}
            />
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
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
          </Box>
        )}
      </Toolbar>
    </AppBar>
  );
}
