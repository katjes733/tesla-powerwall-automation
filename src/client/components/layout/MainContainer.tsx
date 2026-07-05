import Box from "@mui/material/Box";
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
        minHeight: "calc(100vh - 64px - 56px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        width: "100vw",
        paddingTop: "88px", // 64px fixed AppBar + 24px consistent page breathing room
        paddingBottom: "72px", // 56px fixed footer + 16px breathing room
      }}
    >
      {children}
    </Box>
  );
}
