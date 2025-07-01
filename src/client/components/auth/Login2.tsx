import React, { useState, useCallback, useEffect } from "react";
import { useHistory } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Box, CardContent, Container } from "@mui/material";
import { useNotification } from "../notification/NotificationContext";
import {
  StyledButton,
  StyledCard,
  StyledContainerBox,
  StyledHeader,
  StyledTextField,
} from "../App.styles";

const LoginForm = React.memo(
  ({ username, password, onUsernameChange, onPasswordChange, onSubmit }) => (
    <form onSubmit={onSubmit}>
      <StyledTextField
        label="Username"
        variant="outlined"
        fullWidth
        margin="normal"
        value={username}
        onChange={onUsernameChange}
        inputProps={{ autoComplete: "username" }}
      />
      <StyledTextField
        label="Password"
        type="password"
        variant="outlined"
        fullWidth
        margin="normal"
        value={password}
        onChange={onPasswordChange}
        inputProps={{ autoComplete: "current-password" }}
      />
      <Box mt={2} display="flex" justifyContent="center">
        <StyledButton type="submit" variant="contained" color="primary">
          Login
        </StyledButton>
      </Box>
    </form>
  ),
);

LoginForm.displayName = "LoginForm";

const Login = () => {
  const { login, user } = useAuth();
  const { showNotification } = useNotification();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const history = useHistory();

  useEffect(() => {
    if (user) {
      history.push("/");
    }
  }, [user, history]);

  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        await login(username, password);
      } catch (error) {
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
    [login, username, password, showNotification],
  );

  const onUsernameChange = useCallback((e) => setUsername(e.target.value), []);
  const onPasswordChange = useCallback((e) => setPassword(e.target.value), []);

  return (
    <Container maxWidth="sm">
      <StyledContainerBox>
        <StyledCard>
          <CardContent>
            <StyledHeader>Login</StyledHeader>
            <LoginForm
              username={username}
              password={password}
              onUsernameChange={onUsernameChange}
              onPasswordChange={onPasswordChange}
              onSubmit={handleLogin}
            />
          </CardContent>
        </StyledCard>
      </StyledContainerBox>
    </Container>
  );
};

export default Login;
