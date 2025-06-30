import Box from "@mui/material/Box";
import HealthCards from "../health/Health";

export default function MainContainer() {
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        minHeight: "calc(100vh - 64px - 56px)", // 64px AppBar + 56px footer (adjust if needed)
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        width: "100vw",
      }}
    >
      <HealthCards />
    </Box>
  );
}
