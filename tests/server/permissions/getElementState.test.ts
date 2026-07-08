import { describe, it, expect } from "vitest";
import {
  getElementState,
  resolveAccessLevel,
} from "~/shared/permissions/profile";
import type { ActionSchema } from "~/shared/permissions/schema";

describe("getElementState — read profile", () => {
  it("resolves .access keys to write (viewing is always enabled)", () => {
    expect(getElementState("read", "powerwall.access")).toBe("write");
    expect(getElementState("read", "schedule.access")).toBe("write");
    expect(getElementState("read", "calibration.access")).toBe("write");
    expect(getElementState("read", "touConfig.access")).toBe("write");
    expect(getElementState("read", "siteSettings.access")).toBe("write");
    expect(getElementState("read", "health.access")).toBe("write");
  });

  it("resolves mutating actions to read (visible, disabled)", () => {
    expect(getElementState("read", "schedule.create")).toBe("read");
    expect(getElementState("read", "schedule.edit")).toBe("read");
    expect(getElementState("read", "schedule.delete")).toBe("read");
    expect(getElementState("read", "touConfig.delete")).toBe("read");
    expect(getElementState("read", "calibration.gridChargeRate.start")).toBe(
      "read",
    );
    expect(getElementState("read", "siteSettings.write")).toBe("read");
  });

  it("resolves deeply nested dialog fields to read", () => {
    expect(
      getElementState("read", "schedule.dialog.tabs.time.timePicker"),
    ).toBe("read");
    expect(
      getElementState("read", "schedule.dialog.actionConfig.backupReserve.set"),
    ).toBe("read");
  });

  it("hides admin-only domains entirely", () => {
    expect(getElementState("read", "maintenance.access")).toBe("none");
    expect(getElementState("read", "maintenance.refreshToken")).toBe("none");
    expect(getElementState("read", "userAdmin.access")).toBe("none");
    expect(getElementState("read", "userAdmin.invite")).toBe("none");
  });
});

describe("getElementState — write profile", () => {
  it("resolves mutating actions to write", () => {
    expect(getElementState("write", "schedule.create")).toBe("write");
    expect(getElementState("write", "schedule.delete")).toBe("write");
    expect(getElementState("write", "touConfig.delete")).toBe("write");
    expect(getElementState("write", "calibration.gridChargeRate.start")).toBe(
      "write",
    );
    expect(
      getElementState("write", "schedule.dialog.tabs.time.timePicker"),
    ).toBe("write");
  });

  it("still hides admin-only domains entirely", () => {
    expect(getElementState("write", "maintenance.access")).toBe("none");
    expect(getElementState("write", "maintenance.refreshToken")).toBe("none");
    expect(getElementState("write", "userAdmin.access")).toBe("none");
  });
});

describe("getElementState — admin profile", () => {
  it("grants write everywhere, including admin-only domains", () => {
    expect(getElementState("admin", "schedule.delete")).toBe("write");
    expect(getElementState("admin", "maintenance.access")).toBe("write");
    expect(getElementState("admin", "maintenance.refreshToken")).toBe("write");
    expect(getElementState("admin", "userAdmin.access")).toBe("write");
    expect(getElementState("admin", "userAdmin.invite")).toBe("write");
    expect(getElementState("admin", "userAdmin.update")).toBe("write");
    expect(getElementState("admin", "userAdmin.revoke")).toBe("write");
  });
});

describe("resolveAccessLevel — capping mechanism (synthetic profiles)", () => {
  // These exercise the generic "an ancestor's own access caps every leaf
  // beneath it" rule directly, using real ActionKey paths but deliberately
  // inconsistent synthetic profile data — the real app profiles never author
  // a leaf more permissively than its own immediate access sibling, so this
  // is the only way to prove the cap actually overrides rather than merely
  // happening to agree with the leaf value.
  it("caps a descendant leaf authored more permissively than its ancestor's access", () => {
    const profile: ActionSchema = {
      schedule: {
        access: "read",
        dialog: {
          actionConfig: {
            backupReserve: { access: "write", set: "write" },
          },
        },
      },
    };
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.set",
      ),
    ).toBe("read");
  });

  it("caps everything beneath a none ancestor regardless of leaf value", () => {
    const profile: ActionSchema = {
      schedule: {
        access: "none",
        dialog: {
          actionConfig: {
            backupReserve: { access: "write", set: "write" },
          },
        },
      },
    };
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.set",
      ),
    ).toBe("none");
  });

  it("lets an inner container's own tighter access cap its own children", () => {
    const profile: ActionSchema = {
      schedule: {
        access: "write", // outer ancestor: fully open
        dialog: {
          actionConfig: {
            backupReserve: { access: "read", set: "write" }, // inner container: tighter
          },
        },
      },
    };
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.access",
      ),
    ).toBe("read");
    // The leaf was authored "write" but is still capped by its own container's access.
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.set",
      ),
    ).toBe("read");
  });

  it("applies the most restrictive access found anywhere on the path, even over a more permissive inner container", () => {
    // Outer ancestor is the tight one; the inner container's own access value
    // is itself more open — the outer cap must still win for both the inner
    // container's own access lookup and any leaf beneath it.
    const profile: ActionSchema = {
      schedule: {
        access: "read",
        dialog: {
          actionConfig: {
            backupReserve: { access: "write", set: "write" },
          },
        },
      },
    };
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.access",
      ),
    ).toBe("read");
    expect(
      resolveAccessLevel(
        profile,
        "schedule.dialog.actionConfig.backupReserve.set",
      ),
    ).toBe("read");
  });

  it("does not cap an access leaf's own lookup using itself", () => {
    const profile: ActionSchema = {
      schedule: { access: "read" },
    };
    expect(resolveAccessLevel(profile, "schedule.access")).toBe("read");
  });

  it("returns none for an omitted subtree", () => {
    const profile: ActionSchema = {};
    expect(resolveAccessLevel(profile, "schedule.create")).toBe("none");
  });

  it("returns none when the path runs past a leaf value", () => {
    const profile: ActionSchema = { schedule: { access: "write" } };
    // "schedule.access" is a string leaf; walking further into it (as if it
    // were an object) must fail closed rather than throw.
    expect(
      resolveAccessLevel(
        profile,
        "schedule.access.somethingThatShouldNotExist" as never,
      ),
    ).toBe("none");
  });
});
