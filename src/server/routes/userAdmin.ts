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
import { sendEmail, escapeHtml } from "~/server/util/mailing";
import { maskEmail } from "~/server/util/maskEmail";
import { getAppUrl } from "~/server/util/requestOrigin";

const apiLog = logger.child({ service: "userAdmin" });

// Longer than the self-signup default (15 min, see signupVerification.ts) —
// a delegate has to notice the invite email first, possibly much later,
// whereas a self-signup user is already on the login page waiting for it.
const DELEGATE_INVITE_CODE_TTL_HOURS = 24;

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
      // password_hash is only ever used here to derive a boolean — it never leaves
      // this handler. A grant's own status is "active" from the moment it's created
      // (see delegation.ts), regardless of whether the invitee has actually signed
      // up yet — signup_completed is what the UI needs to tell "invited, awaiting
      // signup" apart from "genuinely active" instead of showing both as "active".
      const rows: {
        email: string;
        password_hash: string;
        user_permissions: { delegations?: DelegationGrant[] };
      }[] = await db.query(
        `SELECT email, password_hash, user_permissions FROM ${qualifiedTable("users")} WHERE user_permissions @> $1::jsonb`,
        [
          JSON.stringify({
            delegations: [{ tesla_account_email: accountEmail }],
          }),
        ],
      );
      // Includes revoked grants — the client filters them out by default and
      // shows them only via its "show revoked" audit toggle, but the server
      // doesn't need to know about that UI concern, it just returns the
      // account's full (still cross-account-isolated) grant history.
      const delegates = rows.flatMap((row) =>
        (row.user_permissions?.delegations ?? [])
          .filter((grant) => grant.tesla_account_email === accountEmail)
          .map((grant) => ({
            delegate_email: row.email,
            signup_completed: !!row.password_hash,
            ...grant,
          })),
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

      // Atomic single-statement replace — no read-modify-write race between
      // concurrent admins editing the same delegate's grants. A re-invite is
      // treated as a clean slate: any prior entry for this exact
      // (delegate, account) pair is dropped first (the existingActive check
      // above already guarantees it can only be a revoked one, never an
      // active one) before the fresh grant is appended, rather than piling
      // up one array entry per invite/revoke cycle over the delegate's
      // lifetime.
      await db.query(
        `UPDATE ${qualifiedTable("users")}
         SET user_permissions = jsonb_set(
           coalesce(user_permissions, '{}'::jsonb),
           '{delegations}',
           coalesce(
             (SELECT jsonb_agg(elem)
              FROM jsonb_array_elements(coalesce(user_permissions->'delegations', '[]'::jsonb)) elem
              WHERE elem->>'tesla_account_email' != $2),
             '[]'::jsonb
           ) || $3::jsonb
         ), modified_time = now()
         WHERE email = $1`,
        [delegate_email, accountEmail, JSON.stringify([newGrant])],
      );

      const existingRow: { password_hash: string }[] = await db.query(
        `SELECT password_hash FROM ${qualifiedTable("users")} WHERE email = $1`,
        [delegate_email],
      );
      const hasCompletedSignup = !!existingRow[0]?.password_hash;

      const loginUrl = `${getAppUrl(req)}/login`;
      // Pre-fills the email on the plain login form (no signup) — see
      // Login.tsx's ?email=... handling.
      const loginUrlWithEmail = `${loginUrl}?email=${encodeURIComponent(delegate_email)}`;
      // Deep-links straight to the "enter code + password" step, pre-filled
      // with the invitee's email — see Login.tsx's ?signup=1&email=... handling.
      const signupUrl = `${loginUrl}?signup=1&email=${encodeURIComponent(delegate_email)}`;

      if (!hasCompletedSignup) {
        await generateAndSendCode(
          delegate_email,
          (code) => ({
            subject: "You've been invited to manage a Tesla Powerwall account",
            text: `You've been invited by ${grantedBy} to manage the ${accountEmail} Powerwall account with ${profile} access.

To accept, go to ${signupUrl} and enter the verification code below, then choose a password to finish creating your account.

Your verification code is: ${code}

This code is valid for ${DELEGATE_INVITE_CODE_TTL_HOURS} hours.`,
            html: `<p>You've been invited by ${escapeHtml(grantedBy)} to manage the ${escapeHtml(accountEmail)} Powerwall account with ${escapeHtml(profile)} access.</p>
<p>To accept, <a href="${escapeHtml(signupUrl)}">click here</a> and enter the verification code below, then choose a password to finish creating your account.</p>
<p>Your verification code is: <strong>${code}</strong></p>
<p>This code is valid for ${DELEGATE_INVITE_CODE_TTL_HOURS} hours.</p>`,
          }),
          DELEGATE_INVITE_CODE_TTL_HOURS * 60,
        );
      } else {
        await sendEmail(
          "You've been granted access to a Tesla Powerwall account",
          `You've been granted ${profile} access to the ${accountEmail} Powerwall account by ${grantedBy}.

Log in at ${loginUrlWithEmail} with your existing account to see it.`,
          delegate_email,
          true,
          `<p>You've been granted ${escapeHtml(profile)} access to the ${escapeHtml(accountEmail)} Powerwall account by ${escapeHtml(grantedBy)}.</p>
<p><a href="${escapeHtml(loginUrlWithEmail)}">Log in</a> with your existing account to see it.</p>`,
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
