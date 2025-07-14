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
import axios from "axios";

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

type SignupFormProps = {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
  signupErrors: {
    email?: string;
    code?: string;
    signupPassword?: string;
    signupConfirmPassword?: string;
  };
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEmailBlur: () => void;
  onCodeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCodeBlur: () => void;
  onPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPasswordBlur: () => void;
  onConfirmPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onConfirmPasswordBlur: () => void;
  onSendCode: (e: React.FormEvent<HTMLFormElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  step: number;
  loading: boolean;
};

const SignupForm = React.memo(
  ({
    email,
    code,
    password,
    confirmPassword,
    signupErrors,
    onEmailChange,
    onEmailBlur,
    onCodeChange,
    onCodeBlur,
    onPasswordChange,
    onPasswordBlur,
    onConfirmPasswordChange,
    onConfirmPasswordBlur,
    onSendCode,
    onSubmit,
    step,
    loading,
    onJumpToStep2,
    onResendCode,
  }: SignupFormProps & {
    onJumpToStep2: () => void;
    onResendCode: () => void;
  }) => (
    <>
      {step === 1 && (
        <form onSubmit={onSendCode}>
          <TextField
            label="Email"
            variant="outlined"
            fullWidth
            margin="normal"
            value={email}
            error={Boolean(signupErrors.email)}
            helperText={signupErrors.email}
            onChange={onEmailChange}
            onBlur={onEmailBlur}
          />
          <Box mt={2} display="flex" justifyContent="center" gap={2}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={loading}
            >
              {loading ? "Sending code..." : "Send code"}
            </Button>
            <Button
              variant="outlined"
              color="primary"
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                onJumpToStep2();
              }}
            >
              Have a code?
            </Button>
          </Box>
        </form>
      )}
      {step === 2 && (
        <form onSubmit={onSubmit}>
          <TextField
            label="Verification Code"
            variant="outlined"
            fullWidth
            margin="normal"
            value={code}
            error={Boolean(signupErrors.code)}
            helperText={signupErrors.code}
            onChange={onCodeChange}
            onBlur={onCodeBlur}
          />
          <TextField
            label="Password"
            type="password"
            variant="outlined"
            fullWidth
            margin="normal"
            value={password}
            error={Boolean(signupErrors.signupPassword)}
            helperText={signupErrors.signupPassword}
            onChange={onPasswordChange}
            onBlur={onPasswordBlur}
          />
          <TextField
            label="Confirm Password"
            type="password"
            variant="outlined"
            fullWidth
            margin="normal"
            value={confirmPassword}
            error={Boolean(signupErrors.signupConfirmPassword)}
            helperText={signupErrors.signupConfirmPassword}
            onChange={onConfirmPasswordChange}
            onBlur={onConfirmPasswordBlur}
          />
          <Box mt={2} display="flex" justifyContent="center" gap={2}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={loading}
            >
              {loading ? "Signing up..." : "Sign up"}
            </Button>
            <Button
              variant="outlined"
              color="primary"
              disabled={loading}
              onClick={(e) => {
                e.preventDefault();
                onResendCode();
              }}
            >
              Resend code
            </Button>
          </Box>
        </form>
      )}
    </>
  ),
);

export default function Login() {
  const { user, login, loading } = useAuth();
  const { showNotification } = useNotification();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [signupStep, setSignupStep] = useState(1);
  const [signupCode, setSignupCode] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupErrors, setSignupErrors] = useState({
    email: "",
    code: "",
    signupPassword: "",
    signupConfirmPassword: "",
  });
  const [signupEmailExistsError, setSignupEmailExistsError] = useState(false);
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
            error.response?.data?.error || error.message || "Login error",
            "error",
            5000,
          );
        }
      }
    },
    [login, email, password, showNotification],
  );

  const handleSendCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validateSignupEmail()) {
        showNotification(
          "Please fix the errors before sending code",
          "error",
          5000,
        );
        return;
      }
      setSignupLoading(true);
      axios
        .post("/api/auth/send-code", { email })
        .then(() => {
          setSignupStep(2);
          setSignupEmailExistsError(false);
          showNotification("Verification code sent to your email.", "success");
        })
        .catch((error: any) => {
          if (error.response?.status === 409) {
            setSignupEmailExistsError(true);
            showNotification(
              "User already exists. Please log in instead.",
              "error",
              5000,
            );
          } else {
            setSignupEmailExistsError(false);
            showNotification(
              error.response?.data?.error ||
                error.message ||
                "Error sending code",
              "error",
              5000,
            );
          }
        })
        .finally(() => {
          setSignupLoading(false);
        });
    },
    [email, showNotification],
  );

  const handleResendCode = useCallback(async () => {
    setSignupLoading(true);
    axios
      .post("/api/auth/send-code", { email })
      .then(() => {
        showNotification("Verification code resent to your email.", "success");
      })
      .catch((error: any) => {
        showNotification(
          error.response?.data?.error ||
            error.message ||
            "Error resending code",
          "error",
          5000,
        );
      })
      .finally(() => {
        setSignupLoading(false);
      });
  }, [email, showNotification]);

  const handleSignup = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validateSignupCredentials()) {
        showNotification("Please fix the errors before submitting", "error");
        return;
      }
      setSignupLoading(true);
      axios
        .post("/api/auth/verify-code", {
          email,
          code: signupCode,
        })
        .then(() => {
          axios
            .post("/api/user/upsert", {
              email,
              password: signupPassword,
            })
            .then(() => {
              showNotification(
                "Sign up successful! You can now log in.",
                "success",
              );
              setSignup(false);
              setSignupStep(1);
              setEmail("");
              setPassword("");
              setSignupCode("");
              setSignupPassword("");
              setSignupConfirmPassword("");
            })
            .catch((error: any) => {
              console.error(
                error.response?.data?.error || error.message || "Sign up error",
              );
              showNotification(
                error.response?.data?.error || "Sign up error",
                "error",
                5000,
              );
            });
        })
        .catch((error: any) => {
          console.error(
            "Verification code error:",
            error.response?.data?.error ||
              error.message ||
              "Verification code error",
          );
          showNotification(
            error.response?.data?.error || "Verification code error",
            "error",
            5000,
          );
        })
        .finally(() => {
          setSignupLoading(false);
        });
    },
    [
      showNotification,
      signupPassword,
      signupConfirmPassword,
      signupCode,
      email,
    ],
  );

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleBlurEmail = useCallback(() => {
    let errorMessage = "";
    if (!validateEmail(email)) {
      errorMessage = "Please enter a valid email address.";
    }
    setSignupErrors((prevErrors) => ({
      ...prevErrors,
      email: errorMessage,
    }));
    return !errorMessage;
  }, [email]);

  const validateSignupCode = (code: string) => {
    return /^[0-9]{6}$/.test(code);
  };

  const handleBlurCode = useCallback(() => {
    let errorMessage = "";
    if (!validateSignupCode(signupCode)) {
      errorMessage = "Verification code must be a 6-digit number.";
    }
    setSignupErrors((prevErrors) => ({
      ...prevErrors,
      code: errorMessage,
    }));
    return !errorMessage;
  }, [signupCode]);

  const validatePassword = (password: string) => {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
      password,
    );
  };

  const handleBlurSignupPassword = useCallback(() => {
    let errorMessage = "";
    if (!validatePassword(signupPassword)) {
      errorMessage =
        "Signup password must be at least 8 characters long, include an uppercase letter, a number, and a special character.";
    }
    setSignupErrors((prevErrors) => ({
      ...prevErrors,
      signupPassword: errorMessage,
    }));
    return !errorMessage;
  }, [signupPassword]);

  const handleBlurConfirmPassword = useCallback(() => {
    let errorMessage = "";
    if (signupConfirmPassword !== signupPassword) {
      errorMessage = "New password and confirmation do not match.";
    }
    setSignupErrors((prevErrors) => ({
      ...prevErrors,
      signupConfirmPassword: errorMessage,
    }));
    return !errorMessage;
  }, [signupConfirmPassword, signupPassword]);

  const validateSignupEmail = useCallback(() => {
    return handleBlurEmail();
  }, [handleBlurEmail]);

  const validateSignupCredentials = useCallback(() => {
    return (
      handleBlurCode() &&
      handleBlurSignupPassword() &&
      handleBlurConfirmPassword()
    );
  }, [handleBlurCode, handleBlurSignupPassword, handleBlurConfirmPassword]);

  const onEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.currentTarget.value),
    [],
  );
  const onPasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) =>
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
          {signup ? "Sign up" : "Login"}
        </Typography>
        {signup ? (
          <SignupForm
            email={email}
            code={signupCode}
            password={signupPassword}
            confirmPassword={signupConfirmPassword}
            signupErrors={signupErrors}
            onEmailChange={onEmailChange}
            onEmailBlur={handleBlurEmail}
            onCodeChange={(e) => setSignupCode(e.target.value)}
            onCodeBlur={handleBlurCode}
            onPasswordChange={(e) => setSignupPassword(e.target.value)}
            onPasswordBlur={handleBlurSignupPassword}
            onConfirmPasswordChange={(e) =>
              setSignupConfirmPassword(e.target.value)
            }
            onConfirmPasswordBlur={handleBlurConfirmPassword}
            onSendCode={handleSendCode}
            onSubmit={handleSignup}
            step={signupStep}
            loading={signupLoading}
            onJumpToStep2={() => setSignupStep(2)}
            onResendCode={handleResendCode}
          />
        ) : (
          <LoginForm
            email={email}
            password={password}
            onEmailChange={onEmailChange}
            onPasswordChange={onPasswordChange}
            onSubmit={handleLogin}
          />
        )}
        <Box mt={2} display="flex" justifyContent="center">
          <Button
            variant="text"
            color="primary"
            onClick={() => setSignup((s) => !s)}
            disabled={signupLoading}
          >
            {signup ? "Back to Login" : "Sign up"}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
