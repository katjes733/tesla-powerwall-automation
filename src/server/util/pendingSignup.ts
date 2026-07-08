import { v4 } from "uuid";
import { redis } from "~/server/util/redis";
import AppDataSource from "~/server/database/datasource";

// A brand-new self-signup (no delegate placeholder row already exists for the
// email) isn't written to Postgres until the login completes Tesla OAuth —
// held here instead with a TTL so an abandoned signup just disappears on its
// own, no cleanup job needed. Delegate invites are unaffected: userAdmin.ts
// creates their placeholder row directly in Postgres, so /upsert never takes
// this path for them.
const PENDING_SIGNUP_TTL_SECONDS = 24 * 60 * 60;

export interface PendingSignup {
  passwordHash: string;
  userDetails?: Record<string, unknown>;
  userPermissions?: Record<string, unknown>;
}

function pendingSignupKey(email: string): string {
  return `pending-signup:${email}`;
}

export async function storePendingSignup(
  email: string,
  data: PendingSignup,
): Promise<void> {
  await redis.set(
    pendingSignupKey(email),
    JSON.stringify(data),
    "EX",
    PENDING_SIGNUP_TTL_SECONDS,
  );
}

export async function getPendingSignup(
  email: string,
): Promise<PendingSignup | null> {
  try {
    const raw = await redis.get(pendingSignupKey(email));
    return raw ? (JSON.parse(raw) as PendingSignup) : null;
  } catch {
    // Fail closed — if Redis is unreachable we can't verify a pending
    // signup's credentials, so treat it as not found rather than as a login
    // bypass.
    return null;
  }
}

export async function deletePendingSignup(email: string): Promise<void> {
  await redis.del(pendingSignupKey(email));
}

// Called after a successful Tesla OAuth callback. If this login was a pending
// (Redis-only) self-signup, this is the moment it becomes a real users row —
// the account is now provably linked to a Tesla account, so it's worth
// persisting permanently. No-ops for every other callback (an existing
// owner's routine token refresh), which is the common case.
export async function materializePendingSignupIfAny(
  email: string,
): Promise<void> {
  const pending = await getPendingSignup(email);
  if (!pending) return;

  const userRepo = (await AppDataSource.getInstance()).getRepository("User");
  const existing = await userRepo.findOneBy({ email });
  if (!existing) {
    const now = new Date();
    await userRepo.insert({
      id: v4(),
      creation_time: now,
      modified_time: now,
      email,
      password_hash: pending.passwordHash,
      user_details: pending.userDetails ?? {},
      user_permissions: pending.userPermissions ?? {},
    });
  }
  await deletePendingSignup(email);
}
