import { Alert, Snackbar } from "@mui/material";
import { createContext, useCallback, useContext, useState } from "react";

type NotificationContextType = {
  showNotification: (
    message: string,
    severity?: "error" | "warning" | "info" | "success",
    duration?: number,
  ) => void;
};

const NotificationContext = createContext<NotificationContextType>({
  showNotification: () => {},
});

export const NotificationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: "error" | "warning" | "info" | "success";
    duration: number;
  }>({
    open: false,
    message: "",
    severity: "info",
    duration: 3000,
  });

  const showNotification = useCallback(
    (
      message: string,
      severity: "error" | "warning" | "info" | "success" = "info",
      duration = 3000,
    ) => {
      setNotification({ open: true, message, severity, duration });
    },
    [],
  );

  const closeNotification = useCallback(() => {
    setNotification({
      open: false,
      message: "",
      severity: "info",
      duration: 3000,
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      <Snackbar
        open={notification.open}
        autoHideDuration={notification.duration}
        onClose={closeNotification}
      >
        <Alert severity={notification.severity}>{notification.message}</Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => useContext(NotificationContext);
