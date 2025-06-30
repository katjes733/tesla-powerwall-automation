import { useEffect, useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";

interface HealthStatus {
  status: string;
  message?: string;
}

export default function HealthCards() {
  const [serverHealth, setServerHealth] = useState<HealthStatus | null>(null);
  const [dbHealth, setDbHealth] = useState<HealthStatus | null>(null);
  const [serverError, setServerError] = useState(false);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    fetch("/health/status-server")
      .then((res) => res.json())
      .then((data) => {
        setServerHealth(data);
        setServerError(false);
      })
      .catch(() => {
        setServerError(true);
      });
    fetch("/health/status-db")
      .then((res) => res.json())
      .then((data) => {
        setDbHealth(data);
        setDbError(false);
      })
      .catch(() => {
        setDbError(true);
      });
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        gap: 4,
        justifyContent: "center",
        mx: "auto",
        margin: "32px auto 0px auto",
      }}
    >
      <Card
        elevation={3}
        sx={{
          minWidth: 280,
          maxWidth: 400,
          flex: 1,
          borderRadius: 2,
        }}
      >
        <CardHeader title="Server Health" />
        <CardContent>
          {serverError ? (
            <>
              <Typography color="error" fontWeight={600}>
                Health: Error fetching status
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Could not reach health endpoint.
              </Typography>
            </>
          ) : serverHealth ? (
            serverHealth.status.toLowerCase() === "ok" ? (
              <>
                <Typography color="success.main" fontWeight={600}>
                  Health: OK
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {serverHealth.message || ""}
                </Typography>
              </>
            ) : (
              <>
                <Typography color="error" fontWeight={600}>
                  Health: {serverHealth.status || "Error"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {serverHealth.message || "Service is not healthy"}
                </Typography>
              </>
            )
          ) : (
            <Typography>Loading server health status...</Typography>
          )}
        </CardContent>
      </Card>
      <Card
        elevation={3}
        sx={{
          minWidth: 280,
          maxWidth: 400,
          flex: 1,
          borderRadius: 2,
        }}
      >
        <CardHeader title="Database Health" />
        <CardContent>
          {dbError ? (
            <>
              <Typography color="error" fontWeight={600}>
                Health: Error fetching status
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Could not reach database health endpoint.
              </Typography>
            </>
          ) : dbHealth ? (
            dbHealth.status.toLowerCase() === "ok" ? (
              <>
                <Typography color="success.main" fontWeight={600}>
                  Health: OK
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dbHealth.message || ""}
                </Typography>
              </>
            ) : (
              <>
                <Typography color="error" fontWeight={600}>
                  Health: {dbHealth.status || "Error"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {dbHealth.message || "Database is not healthy"}
                </Typography>
              </>
            )
          ) : (
            <Typography>Loading database health status...</Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
