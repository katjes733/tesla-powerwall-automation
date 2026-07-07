import express from "express";
import { v4 } from "uuid";
import { requireAuth } from "~/server/middleware/auth";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import { getByEmail } from "~/server/util/routes/refreshToken";
import { buildTeslaAuthorizeUrl } from "~/server/util/oauthCallback";

const clientId = process.env.TESLA_CLIENT_ID;
const baseAuthUrl =
  process.env.TESLA_AUTH_BASE_URL ||
  "https://fleet-auth.prd.vn.cloud.tesla.com";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const apiLog = logger.child({ service: "maintenance" });

export const router = express.Router();
router.use(requireAuth);

router.get("/refresh-token/status", async (req, res, next) => {
  const email = getCurrentAccountEmail(req)!;
  try {
    const record = await getByEmail(email);
    res.json({
      success: true,
      data: {
        email,
        hasToken: !!record,
        expiresAt: record?.expiresAt ?? null,
      },
    });
  } catch (error: any) {
    apiLog.error({ err: error, email }, "Error fetching refresh token status");
    next(error);
  }
});

router.post("/refresh-token/start", (req, res) => {
  const email = getCurrentAccountEmail(req)!;
  if (!clientId) {
    res
      .status(500)
      .json({ success: false, message: "TESLA_CLIENT_ID is not configured" });
    return;
  }

  const state = v4();
  // Starting a new flow overwrites any in-flight one for this session —
  // acceptable, last-request-wins.
  req.session.oauthState = {
    value: state,
    email,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };

  const redirectUri = `${req.protocol}://${req.get("host")}/callback`;
  const authorizeUrl = buildTeslaAuthorizeUrl({
    clientId,
    baseAuthUrl,
    redirectUri,
    state,
  });

  apiLog.info(
    { event: "maintenance.refresh_token.start", email },
    "Refresh token flow started",
  );
  res.json({ success: true, data: { authorizeUrl } });
});
