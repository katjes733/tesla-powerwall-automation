import { z } from "zod";
import { PROFILE_NAMES } from "~/shared/permissions/profile";

export const SiteIdsSchema = z.union([
  z.literal("*"),
  z.array(z.string().min(1)),
]);

export const DelegationGrantSchema = z.object({
  tesla_account_email: z.string().email(),
  profile: z.enum(PROFILE_NAMES),
  site_ids: SiteIdsSchema,
  status: z.enum(["active", "revoked"]),
  granted_by: z.string().email(),
  invite_code_sent_at: z.string().optional(),
  revoked_at: z.string().optional(),
  creation_time: z.string(),
});

export const DelegationInviteSchema = z.object({
  delegate_email: z.string().email(),
  profile: z.enum(PROFILE_NAMES),
  site_ids: SiteIdsSchema,
});

export const DelegationUpdateSchema = z.object({
  delegate_email: z.string().email(),
  profile: z.enum(PROFILE_NAMES),
  site_ids: SiteIdsSchema,
});

export const DelegationRevokeSchema = z.object({
  delegate_email: z.string().email(),
});

export type DelegationGrant = z.infer<typeof DelegationGrantSchema>;
export type DelegationInviteInput = z.infer<typeof DelegationInviteSchema>;
export type DelegationUpdateInput = z.infer<typeof DelegationUpdateSchema>;
export type DelegationRevokeInput = z.infer<typeof DelegationRevokeSchema>;

// shape of users.user_permissions for a delegate:
export interface DelegateUserPermissions {
  delegations?: DelegationGrant[];
}
