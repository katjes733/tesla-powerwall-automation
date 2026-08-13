import { useContext } from "react";
import { NotificationContext } from "./notificationContextValue";

export const useNotification = () => useContext(NotificationContext);
