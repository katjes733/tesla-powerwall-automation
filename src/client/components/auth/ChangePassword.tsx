import { useCallback, useState } from "react";
import axios from "axios";
import { useHistory } from "react-router-dom";
import { Box, CardContent, Container } from "@mui/material";
import { useNotification } from "../notification/NotificationContext";
import { useAuth } from "./AuthContext";
import {
  StyledButton,
  StyledCard,
  StyledContainerBox,
  StyledHeader,
  StyledTextField,
} from "../App.styles";

const ChangePassword = () => {
  const { user } = useAuth();
  const history = useHistory();
  const { showNotification } = useNotification();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const validatePassword = (password) => {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(
      password,
    );
  };

  const handleBlurCurrentPassword = useCallback(() => {
    let errorMessage = "";
    if (!currentPassword) {
      errorMessage = "Current password is required.";
    }
    setErrors((prevErrors) => ({
      ...prevErrors,
      currentPassword: errorMessage,
    }));
  }, [currentPassword]);

  const handleBlurNewPassword = useCallback(() => {
    let errorMessage = "";
    if (!validatePassword(newPassword)) {
      errorMessage =
        "New password must be at least 8 characters long, include an uppercase letter, a number, and a special character.";
    }
    setErrors((prevErrors) => ({
      ...prevErrors,
      newPassword: errorMessage,
    }));
  }, [newPassword]);

  const handleBlurConfirmPassword = useCallback(() => {
    let errorMessage = "";
    if (confirmPassword !== newPassword) {
      errorMessage = "New password and confirmation do not match.";
    }
    setErrors((prevErrors) => ({
      ...prevErrors,
      confirmPassword: errorMessage,
    }));
  }, [confirmPassword, newPassword]);

  const validate = useCallback(() => {
    handleBlurCurrentPassword();
    handleBlurNewPassword();
    handleBlurConfirmPassword();
    return !Object.values(errors).some((error) => Boolean(error));
  }, [
    errors,
    handleBlurCurrentPassword,
    handleBlurNewPassword,
    handleBlurConfirmPassword,
  ]);

  const handlePasswordChange = useCallback(
    async (e) => {
      e.preventDefault();
      if (validate()) {
        try {
          await axios.post("/user/change-password", {
            username: user.username,
            currentPassword,
            newPassword,
          });
          showNotification("Password changed successfully!", "info");
          setTimeout(() => {
            history.push("/");
          }, 500);
        } catch (error) {
          console.error("Error changing password:", error.response.data.error);
          showNotification(error.response.data.error, "error", 5000);
        }
      }
    },
    [
      currentPassword,
      newPassword,
      user.username,
      validate,
      showNotification,
      history,
    ],
  );

  const handleCancel = useCallback(() => {
    history.push("/");
  }, [history]);

  const handleCurrentPasswordChange = useCallback(
    (e) => setCurrentPassword(e.target.value),
    [],
  );

  const handleNewPasswordChange = useCallback(
    (e) => setNewPassword(e.target.value),
    [],
  );

  const handleConfirmPasswordChange = useCallback(
    (e) => setConfirmPassword(e.target.value),
    [],
  );

  return (
    <Container maxWidth="sm">
      <StyledContainerBox>
        <StyledCard>
          <CardContent>
            <StyledHeader>Change Password</StyledHeader>
            <form onSubmit={handlePasswordChange}>
              <StyledTextField
                label="Current Password"
                type="password"
                variant="outlined"
                fullWidth
                margin="normal"
                value={currentPassword}
                error={Boolean(errors.currentPassword)}
                helperText={errors.currentPassword}
                onChange={handleCurrentPasswordChange}
                onBlur={handleBlurCurrentPassword}
              />
              <StyledTextField
                label="New Password"
                type="password"
                variant="outlined"
                fullWidth
                margin="normal"
                value={newPassword}
                error={Boolean(errors.newPassword)}
                helperText={errors.newPassword}
                onChange={handleNewPasswordChange}
                onBlur={handleBlurNewPassword}
              />
              <StyledTextField
                label="Confirm New Password"
                type="password"
                variant="outlined"
                fullWidth
                margin="normal"
                value={confirmPassword}
                error={Boolean(errors.confirmPassword)}
                helperText={errors.confirmPassword}
                onChange={handleConfirmPasswordChange}
                onBlur={handleBlurConfirmPassword}
              />
              <Box mt={2} display="flex" justifyContent="center">
                <StyledButton type="submit" variant="contained" color="primary">
                  Change Password
                </StyledButton>
                <StyledButton
                  onClick={handleCancel}
                  variant="contained"
                  color="secondary"
                >
                  Cancel
                </StyledButton>
              </Box>
            </form>
          </CardContent>
        </StyledCard>
      </StyledContainerBox>
    </Container>
  );
};

export default ChangePassword;
