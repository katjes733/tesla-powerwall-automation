import express from "express";
import { v4 } from "uuid";
import { resolveActorAllowingUnlinked } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { getCurrentAccountEmail } from "~/server/util/currentAccount";
import { getByEmail } from "~/server/util/routes/refreshToken";
import { buildTeslaAuthorizeUrl } from "~/server/util/oauthCallback";
import { getPublicOrigin } from "~/server/util/requestOrigin";
import { isTokenStale } from "~/server/util/notificationDedup";

const clientId = process.env.TESLA_CLIENT_ID;
const baseAuthUrl =
  process.env.TESLA_AUTH_BASE_URL ||
  "https://fleet-auth.prd.vn.cloud.tesla.com";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const apiLog = logger.child({ service: "maintenance" });

export const router = express.Router();
router.use(resolveActorAllowingUnlinked);

router.get(
  "/refresh-token/status",
  requirePermission("maintenance.access"),
  async (req, res, next) => {
    const email = getCurrentAccountEmail(req)!;
    try {
      const record = await getByEmail(email);
      res.json({
        success: true,
        data: {
          email,
          hasToken: !!record,
          // `stale` mirrors the same isTokenStale() check the daily token-
          // staleness cron uses — the DB's `expires_at` is the access token's
          // own cache expiry (refreshed automatically), not the refresh
          // token's lifetime, so "stale" (not "expiring soon") is the
          // meaningful signal here.
          stale: record ? isTokenStale(record.expiresAt) : false,
          lastRefreshedAt: record?.modifiedTime ?? null,
          lastRefreshError: record?.lastRefreshError ?? null,
          lastRefreshErrorAt: record?.lastRefreshErrorAt ?? null,
        },
      });
    } catch (error: any) {
      apiLog.error(
        { err: error, email },
        "Error fetching refresh token status",
      );
      next(error);
    }
  },
);

router.post(
  "/refresh-token/start",
  requirePermission("maintenance.refreshToken"),
  (req, res) => {
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

    const redirectUri = `${getPublicOrigin(req)}/callback`;
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
  },
);
