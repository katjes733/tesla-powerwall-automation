import express from "express";
import AppDataSource, { qualifiedTable } from "~/server/database/datasource";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { validateBody } from "~/server/middleware/validateBody";
import {
  DelegationInviteSchema,
  DelegationUpdateSchema,
  DelegationRevokeSchema,
  type DelegationGrant,
} from "~/shared/schemas/delegation";
import { generateAndSendCode } from "~/server/routes/signupVerification";
import { sendEmail } from "~/server/util/mailing";
import { maskEmail } from "~/server/util/maskEmail";
import { getPublicOrigin } from "~/server/util/requestOrigin";

const apiLog = logger.child({ service: "userAdmin" });

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get(
  "/delegates",
  requirePermission("userAdmin.access"),
  async (req, res, next) => {
    const accountEmail = req.actor!.accountEmail;
    try {
      const db = await AppDataSource.getInstance();
      // Cross-table containment scan — the cold path, only hit when an Admin opens
      // this page — accelerated by idx_users_user_permissions_gin (see datasource.ts).
      const rows: {
        email: string;
        user_permissions: { delegations?: DelegationGrant[] };
      }[] = await db.query(
        `SELECT email, user_permissions FROM ${qualifiedTable("users")} WHERE user_permissions @> $1::jsonb`,
        [
          JSON.stringify({
            delegations: [{ tesla_account_email: accountEmail }],
          }),
        ],
      );
      const delegates = rows.flatMap((row) =>
        (row.user_permissions?.delegations ?? [])
          .filter(
            (grant) =>
              grant.tesla_account_email === accountEmail &&
              grant.status !== "revoked",
          )
          .map((grant) => ({ delegate_email: row.email, ...grant })),
      );
      res.json({ success: true, data: delegates });
    } catch (error) {
      apiLog.error({ err: error }, "Error listing delegates");
      next(error);
    }
  },
);

router.post(
  "/delegates/invite",
  requirePermission("userAdmin.invite"),
  validateBody(DelegationInviteSchema),
  async (req, res, next) => {
    const accountEmail = req.actor!.accountEmail;
    const grantedBy = req.actor!.loginEmail;
    const { delegate_email, profile, site_ids } = req.body as {
      delegate_email: string;
      profile: DelegationGrant["profile"];
      site_ids: DelegationGrant["site_ids"];
    };

    // Belt-and-suspenders: the owner's admin status is derived from RefreshToken
    // presence, never from a stored grant — this just stops a confusing,
    // meaningless self-referential row from being created in the first place.
    if (delegate_email === accountEmail) {
      res.status(400).json({
        success: false,
        message: "Cannot create a delegation for the account's own owner email",
      });
      return;
    }

    try {
      const db = await AppDataSource.getInstance();

      const existingActive: unknown[] = await db.query(
        `SELECT 1 FROM ${qualifiedTable("users")} WHERE email = $1 AND user_permissions @> $2::jsonb`,
        [
          delegate_email,
          JSON.stringify({
            delegations: [
              { tesla_account_email: accountEmail, status: "active" },
            ],
          }),
        ],
      );
      if (existingActive.length > 0) {
        res.status(409).json({
          success: false,
          message: "This email already has an active grant for this account",
        });
        return;
      }

      const newGrant: DelegationGrant = {
        tesla_account_email: accountEmail,
        profile,
        site_ids,
        status: "active",
        granted_by: grantedBy,
        invite_code_sent_at: new Date().toISOString(),
        creation_time: new Date().toISOString(),
      };

      // Guarantee the delegate's row exists (a placeholder if brand new, using an
      // empty password_hash as the "signup not yet completed" sentinel) without
      // disturbing it if it already does — this is what lets a pending invite
      // exist before the invitee is a real user.
      await db.query(
        `INSERT INTO ${qualifiedTable("users")} (creation_time, modified_time, email, password_hash, user_permissions)
         VALUES (now(), now(), $1, '', $2::jsonb)
         ON CONFLICT (email) DO NOTHING`,
        [delegate_email, JSON.stringify({ delegations: [] })],
      );

      // Atomic single-statement append — no read-modify-write race between
      // concurrent admins editing the same delegate's grants.
      await db.query(
        `UPDATE ${qualifiedTable("users")}
         SET user_permissions = jsonb_set(
           coalesce(user_permissions, '{}'::jsonb),
           '{delegations}',
           coalesce(user_permissions->'delegations', '[]'::jsonb) || $2::jsonb
         ), modified_time = now()
         WHERE email = $1`,
        [delegate_email, JSON.stringify([newGrant])],
      );

      const existingRow: { password_hash: string }[] = await db.query(
        `SELECT password_hash FROM ${qualifiedTable("users")} WHERE email = $1`,
        [delegate_email],
      );
      const hasCompletedSignup = !!existingRow[0]?.password_hash;

      const loginUrl = `${getPublicOrigin(req)}/login`;

      if (!hasCompletedSignup) {
        await generateAndSendCode(delegate_email, (code) => ({
          subject: "You've been invited to manage a Tesla Powerwall account",
          text: `You've been invited by ${grantedBy} to manage the ${accountEmail} Powerwall account with ${profile} access.

To accept, go to ${loginUrl} and click "Sign up". Enter this email address (${delegate_email}) and the verification code below, then choose a password to finish creating your account.

Your verification code is: ${code}

This code is valid for 15 minutes.`,
        }));
      } else {
        await sendEmail(
          "You've been granted access to a Tesla Powerwall account",
          `You've been granted ${profile} access to the ${accountEmail} Powerwall account by ${grantedBy}.

Log in at ${loginUrl} with your existing account to see it.`,
          delegate_email,
        );
      }

      apiLog.info(
        {
          event: "userAdmin.delegate.invited",
          accountEmail: maskEmail(accountEmail),
          delegateEmail: maskEmail(delegate_email),
          profile,
        },
        "Delegate invited",
      );
      res.status(201).json({ success: true, data: newGrant });
    } catch (error) {
      apiLog.error({ err: error }, "Error inviting delegate");
      next(error);
    }
  },
);

router.post(
  "/delegates/update",
  requirePermission("userAdmin.update"),
  validateBody(DelegationUpdateSchema),
  async (req, res, next) => {
    const accountEmail = req.actor!.accountEmail;
    const { delegate_email, profile, site_ids } = req.body as {
      delegate_email: string;
      profile: DelegationGrant["profile"];
      site_ids: DelegationGrant["site_ids"];
    };

    if (delegate_email === accountEmail) {
      res.status(400).json({
        success: false,
        message: "Cannot edit a delegation for the account's own owner email",
      });
      return;
    }

    try {
      const db = await AppDataSource.getInstance();
      await db.query(
        `UPDATE ${qualifiedTable("users")}
         SET user_permissions = jsonb_set(
           user_permissions, '{delegations}',
           (SELECT jsonb_agg(
              CASE WHEN elem->>'tesla_account_email' = $2
                   THEN (elem - 'profile' - 'site_ids') || jsonb_build_object('profile', $3::jsonb, 'site_ids', $4::jsonb)
                   ELSE elem END)
            FROM jsonb_array_elements(user_permissions->'delegations') elem)
         ), modified_time = now()
         WHERE email = $1`,
        [
          delegate_email,
          accountEmail,
          JSON.stringify(profile),
          JSON.stringify(site_ids),
        ],
      );
      apiLog.info(
        {
          event: "userAdmin.delegate.updated",
          accountEmail: maskEmail(accountEmail),
          delegateEmail: maskEmail(delegate_email),
          profile,
        },
        "Delegate grant updated",
      );
      res.json({ success: true });
    } catch (error) {
      apiLog.error({ err: error }, "Error updating delegate");
      next(error);
    }
  },
);

router.post(
  "/delegates/revoke",
  requirePermission("userAdmin.revoke"),
  validateBody(DelegationRevokeSchema),
  async (req, res, next) => {
    const accountEmail = req.actor!.accountEmail;
    const { delegate_email } = req.body as { delegate_email: string };

    try {
      const db = await AppDataSource.getInstance();
      await db.query(
        `UPDATE ${qualifiedTable("users")}
         SET user_permissions = jsonb_set(
           user_permissions, '{delegations}',
           (SELECT jsonb_agg(
              CASE WHEN elem->>'tesla_account_email' = $2
                   THEN (elem - 'status' - 'revoked_at') || jsonb_build_object('status', 'revoked', 'revoked_at', to_jsonb(now()::text))
                   ELSE elem END)
            FROM jsonb_array_elements(user_permissions->'delegations') elem)
         ), modified_time = now()
         WHERE email = $1`,
        [delegate_email, accountEmail],
      );
      apiLog.info(
        {
          event: "userAdmin.delegate.revoked",
          accountEmail: maskEmail(accountEmail),
          delegateEmail: maskEmail(delegate_email),
        },
        "Delegate access revoked",
      );
      res.json({ success: true });
    } catch (error) {
      apiLog.error({ err: error }, "Error revoking delegate");
      next(error);
    }
  },
);
