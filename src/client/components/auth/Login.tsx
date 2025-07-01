import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useNotification } from "../notification/NotificationContext";

type LoginFormProps = {
  email: string;
  password: string;
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
};

const LoginForm = React.memo(
  ({
    email,
    password,
    onEmailChange,
    onPasswordChange,
    onSubmit,
  }: LoginFormProps) => (
    <form onSubmit={onSubmit}>
      <TextField
        label="Email"
        variant="outlined"
        fullWidth
        margin="normal"
        value={email}
        onChange={onEmailChange}
        slotProps={{
          htmlInput: { autoComplete: "email" },
        }}
      />
      <TextField
        label="Password"
        type="password"
        variant="outlined"
        fullWidth
        margin="normal"
        value={password}
        onChange={onPasswordChange}
        slotProps={{
          htmlInput: { autoComplete: "current-password" },
        }}
      />
      <Box mt={2} display="flex" justifyContent="center">
        <Button type="submit" variant="contained" color="primary">
          Login
        </Button>
      </Box>
    </form>
  ),
);

export default function Login() {
  const { user, login, loading } = useAuth();
  const { showNotification } = useNotification();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        await login(email, password);
      } catch (error: any) {
        setPassword("");
        if (error.response?.status === 403) {
          showNotification(
            "User has insufficient permissions to use this application",
            "error",
            5000,
          );
        } else {
          showNotification(
            error.response?.data?.error || "Login error",
            "error",
            5000,
          );
        }
      }
    },
    [login, email, password, showNotification],
  );

  const onEmailChange = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => setEmail(e.currentTarget.value),
    [],
  );
  const onPasswordChange = useCallback(
    (e: React.FormEvent<HTMLInputElement>) =>
      setPassword(e.currentTarget.value),
    [],
  );

  return (
    <Box
      sx={{
        width: "100vw",
        minHeight: "calc(100vh - 64px - 56px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          minWidth: 320,
          maxWidth: 400,
          width: "100%",
          bgcolor: "background.paper",
        }}
      >
        <Typography variant="h5" align="center" mb={2}>
          Login
        </Typography>
        <LoginForm
          email={email}
          password={password}
          onEmailChange={onEmailChange}
          onPasswordChange={onPasswordChange}
          onSubmit={handleLogin}
        />
      </Paper>
    </Box>
  );
}
