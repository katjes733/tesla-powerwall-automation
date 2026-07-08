import type { AccessLevel, ActionKey, ActionSchema } from "./schema";

export const PROFILE_NAMES = ["read", "write", "admin"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 };
const min = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;

// A profile is simply a concrete, sparse value of type ActionSchema — no separate
// "Profile" type needed. Every field is optional, so a profile only states what it
// grants; anything omitted defaults to "none" (hidden) at lookup time.

export const READ_PROFILE: ActionSchema = {
  powerwall: { access: "write" }, // reading is always fully enabled for read-and-above
  schedule: {
    access: "write",
    create: "read",
    edit: "read",
    toggleEnabled: "read",
    delete: "read", // visible, disabled — not hidden
    dialog: {
      siteSelector: { changeSites: "read" },
      save: "read",
      tabs: {
        time: {
          timePicker: "read",
          repeatDays: "read",
          recoverySelect: "read",
        },
        powerwall: {
          optionSelect: "read",
          valueSlider: "read",
          betweenHours: "read",
        },
        flow: {
          optionSelect: "read",
          valueSlider: "read",
          betweenHours: "read",
        },
        smart: {
          modeSelect: "read",
          customDaysToggle: "read",
          touTimePickers: "read",
          customTimePickers: "read",
        },
        holidays: {
          sourceSelect: "read",
          populateButton: "read",
          addCustomButton: "read",
          deleteEntry: "read",
          recoverySelect: "read",
          autoPopulateDialog: {
            selectAll: "read",
            deselectAll: "read",
            addSelected: "read",
          },
          addCustomDialog: { save: "read" },
        },
      },
      actionConfig: {
        backupReserve: { access: "read", set: "read", unset: "read" },
        preserveBattery: { access: "read", set: "read", unset: "read" },
        operationalMode: { access: "read", set: "read", unset: "read" },
        energyExports: { access: "read", set: "read", unset: "read" },
        gridCharging: { access: "read", set: "read", unset: "read" },
        smartGridCharging: { access: "read", set: "read", unset: "read" },
        calibrateGridChargeRate: { access: "read", set: "read", unset: "read" },
        calibrateChargeCurve: { access: "read", set: "read", unset: "read" },
      },
    },
  },
  calibration: {
    access: "write",
    gridChargeRate: { start: "read", clear: "read", scheduleRunOnce: "read" },
    curve: {
      start: "read",
      clear: "read",
      stop: "read",
      toggleAuto: "read",
      scheduleRunOnce: "read",
    },
    scheduleDialog: { datePicker: "read", save: "read", cancelRun: "read" },
  },
  touConfig: {
    access: "write",
    create: "read",
    edit: "read",
    copy: "read",
    delete: "read",
    apply: "read",
  },
  siteSettings: { access: "write", write: "read" },
  health: { access: "write" },
  // maintenance, userAdmin: omitted entirely — every leaf resolves to "none" (hidden)
};

// Every leaf READ_PROFILE marks "read" (visible-disabled) becomes "write" (visible-
// enabled) here. Authored independently, not derived from READ_PROFILE at runtime —
// the duplication below is a one-time authoring cost, not a semantic dependency a
// future custom profile would need to replicate.
export const WRITE_PROFILE: ActionSchema = {
  powerwall: { access: "write", applySettings: "write" },
  schedule: {
    access: "write",
    create: "write",
    edit: "write",
    toggleEnabled: "write",
    delete: "write",
    dialog: {
      siteSelector: { changeSites: "write" },
      save: "write",
      tabs: {
        time: {
          timePicker: "write",
          repeatDays: "write",
          recoverySelect: "write",
        },
        powerwall: {
          optionSelect: "write",
          valueSlider: "write",
          betweenHours: "write",
        },
        flow: {
          optionSelect: "write",
          valueSlider: "write",
          betweenHours: "write",
        },
        smart: {
          modeSelect: "write",
          customDaysToggle: "write",
          touTimePickers: "write",
          customTimePickers: "write",
        },
        holidays: {
          sourceSelect: "write",
          populateButton: "write",
          addCustomButton: "write",
          deleteEntry: "write",
          recoverySelect: "write",
          autoPopulateDialog: {
            selectAll: "write",
            deselectAll: "write",
            addSelected: "write",
          },
          addCustomDialog: { save: "write" },
        },
      },
      actionConfig: {
        backupReserve: { access: "write", set: "write", unset: "write" },
        preserveBattery: { access: "write", set: "write", unset: "write" },
        operationalMode: { access: "write", set: "write", unset: "write" },
        energyExports: { access: "write", set: "write", unset: "write" },
        gridCharging: { access: "write", set: "write", unset: "write" },
        smartGridCharging: { access: "write", set: "write", unset: "write" },
        calibrateGridChargeRate: {
          access: "write",
          set: "write",
          unset: "write",
        },
        calibrateChargeCurve: { access: "write", set: "write", unset: "write" },
      },
    },
  },
  calibration: {
    access: "write",
    gridChargeRate: {
      start: "write",
      clear: "write",
      scheduleRunOnce: "write",
    },
    curve: {
      start: "write",
      clear: "write",
      stop: "write",
      toggleAuto: "write",
      scheduleRunOnce: "write",
    },
    scheduleDialog: { datePicker: "write", save: "write", cancelRun: "write" },
  },
  touConfig: {
    access: "write",
    create: "write",
    edit: "write",
    copy: "write",
    delete: "write",
    apply: "write",
  },
  siteSettings: { access: "write", write: "write" },
  health: { access: "write" },
  // maintenance, userAdmin: still omitted — still "none" for Write
};

// Admin = Write plus the two admin-only domains. Composing via spread is fine here
// since it's authoring convenience, not a semantic dependency a future custom
// profile would need to replicate.
export const ADMIN_PROFILE: ActionSchema = {
  ...WRITE_PROFILE,
  maintenance: { access: "write", refreshToken: "write" },
  userAdmin: {
    access: "write",
    invite: "write",
    update: "write",
    revoke: "write",
  },
};

export const PROFILES: Record<ProfileName, ActionSchema> = {
  read: READ_PROFILE,
  write: WRITE_PROFILE,
  admin: ADMIN_PROFILE,
};

// Path lookup into whichever profile object, with one mechanical rule beyond a plain
// path-walk: "access" means the same thing at every depth — "can this be reached/
// viewed at all" — so wherever a container along the path defines its own "access"
// sibling (schedule.access, backupReserve.access, etc.), that value is a hard CAP on
// every leaf nested anywhere beneath it, transitively, regardless of what those
// leaves are individually authored to.
export function getElementState(
  profileName: ProfileName,
  action: ActionKey,
): AccessLevel {
  const segments = action.split(".");
  let node: unknown = PROFILES[profileName];
  let cap: AccessLevel = "write"; // uncapped until an ancestor's own "access" says otherwise
  for (let i = 0; i < segments.length; i++) {
    if (node == null || typeof node !== "object") return "none";
    const container = node as Record<string, unknown>;
    if (segments[i] !== "access" && typeof container.access === "string") {
      cap = min(cap, container.access as AccessLevel);
    }
    node = container[segments[i]];
  }
  const own = typeof node === "string" ? (node as AccessLevel) : "none";
  return min(own, cap);
}
