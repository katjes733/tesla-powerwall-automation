// Pure structural schema — no permission values live here. Every field optional,
// recursively, to any depth. A leaf's TYPE (AccessLevel) declares what kind of
// value can go there; a concrete profile object (see profile.ts) is what actually
// assigns one. Enumerated down to individual dialog controls, not just top-level
// actions, so every gateable UI element has a home here.

export type AccessLevel = "none" | "read" | "write";

export interface ActionSchema {
  powerwall?: { access?: AccessLevel; applySettings?: AccessLevel };

  schedule?: {
    access?: AccessLevel;
    create?: AccessLevel;
    edit?: AccessLevel;
    toggleEnabled?: AccessLevel;
    delete?: AccessLevel;
    dialog?: {
      siteSelector?: { changeSites?: AccessLevel };
      save?: AccessLevel;
      tabs?: {
        time?: {
          timePicker?: AccessLevel;
          repeatDays?: AccessLevel;
          recoverySelect?: AccessLevel;
        };
        powerwall?: {
          optionSelect?: AccessLevel;
          valueSlider?: AccessLevel;
          betweenHours?: AccessLevel;
        };
        flow?: {
          optionSelect?: AccessLevel;
          valueSlider?: AccessLevel;
          betweenHours?: AccessLevel;
        };
        smart?: {
          modeSelect?: AccessLevel;
          customDaysToggle?: AccessLevel;
          touTimePickers?: AccessLevel;
          customTimePickers?: AccessLevel;
        };
        holidays?: {
          sourceSelect?: AccessLevel;
          populateButton?: AccessLevel;
          addCustomButton?: AccessLevel;
          deleteEntry?: AccessLevel;
          recoverySelect?: AccessLevel;
          autoPopulateDialog?: {
            selectAll?: AccessLevel;
            deselectAll?: AccessLevel;
            addSelected?: AccessLevel;
          };
          addCustomDialog?: { save?: AccessLevel };
        };
      };
      // shared dialog reused from the Time/Powerwall/Flow/Smart tabs' action-list entries —
      // one schema entry per underlying Fleet action, not one per calling tab
      actionConfig?: {
        backupReserve?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        preserveBattery?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        operationalMode?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        energyExports?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        gridCharging?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        smartGridCharging?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        calibrateGridChargeRate?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
        calibrateChargeCurve?: {
          access?: AccessLevel;
          set?: AccessLevel;
          unset?: AccessLevel;
        };
      };
    };
  };

  calibration?: {
    access?: AccessLevel;
    gridChargeRate?: {
      start?: AccessLevel;
      clear?: AccessLevel;
      scheduleRunOnce?: AccessLevel;
    };
    curve?: {
      start?: AccessLevel;
      clear?: AccessLevel;
      stop?: AccessLevel;
      toggleAuto?: AccessLevel;
      scheduleRunOnce?: AccessLevel;
    };
    scheduleDialog?: {
      datePicker?: AccessLevel;
      save?: AccessLevel;
      cancelRun?: AccessLevel;
    };
  };

  maintenance?: { access?: AccessLevel; refreshToken?: AccessLevel };
  userAdmin?: {
    access?: AccessLevel;
    invite?: AccessLevel;
    update?: AccessLevel;
    revoke?: AccessLevel;
  };

  // touConfig, siteSettings, powerwall.history, health, and ManualSettings follow the
  // identical pattern demonstrated above (top-level actions + a nested "dialog" tree per
  // field/control) — enumerate against the real TouEditorDialog/SeasonEditor/TouPeriodList/
  // ManualSettings component trees as those get gated, following schedule/calibration above.
  touConfig?: {
    access?: AccessLevel;
    create?: AccessLevel;
    edit?: AccessLevel;
    copy?: AccessLevel;
    delete?: AccessLevel;
    apply?: AccessLevel;
  };
  siteSettings?: { access?: AccessLevel; write?: AccessLevel };
  health?: { access?: AccessLevel };
  notificationPreferences?: { access?: AccessLevel };
}

// Recursive dotted-path union over the schema — "schedule.dialog.tabs.time.timePicker" |
// "calibration.gridChargeRate.start" | ... — works at any depth, no cap. NonNullable<>
// strips the `| undefined` every optional property carries before checking/recursing.
type ActionKeysOf<T, Prefix extends string = ""> = {
  [K in keyof T & string]: NonNullable<T[K]> extends AccessLevel
    ? `${Prefix}${K}`
    : ActionKeysOf<NonNullable<T[K]>, `${Prefix}${K}.`>;
}[keyof T & string];

export type ActionKey = ActionKeysOf<ActionSchema>;
