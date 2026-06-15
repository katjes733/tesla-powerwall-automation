import Box from "@mui/material/Box";
import HealthCards from "../health/Health";

import { type ReactNode } from "react";

interface MainContainerProps {
  children: ReactNode;
}

export default function MainContainer({ children }: MainContainerProps) {
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
      {children}
    </Box>
  );
}
