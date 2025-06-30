import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import NavMenu from "./components/layout/NavMenu";
import MainContainer from "./components/layout/MainContainer";
import Footer from "./components/layout/Footer";

function App() {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = createTheme({
    palette: {
      mode: prefersDarkMode ? "dark" : "light",
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NavMenu />
      <MainContainer />
      <Footer />
    </ThemeProvider>
  );
}

export default App;
