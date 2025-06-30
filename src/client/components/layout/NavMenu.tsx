import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import logo from "../../assets/logo.png";

export default function NavMenu() {
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
      </Toolbar>
    </AppBar>
  );
}
