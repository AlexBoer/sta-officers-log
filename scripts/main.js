import { CallbackRequestApp } from "./callback/CallbackRequestApp.js";
import { MODULE_ID, t, tf, initSocket } from "./core/index.js";
import { applyKlingonMode } from "./core/i18n.js";
import {
  addParticipantToCurrentMission,
  endCurrentMission,
  ensureGroupShipTokenLinked,
  ensureNewSceneMacro,
  ensureOpenGroupShipMacro,
  getMissionHistory,
  hasUsedCallbackThisMission,
  newScene,
  openGroupShip,
  promptAddParticipant,
  promptNewMissionAndReset,
  promptUnaddedActivePlayers,
  reactivateLastEndedMission,
  reactivateMissionFromHistory,
  registerMissionSettings,
  removeMissionFromHistory,
  resetMissionCallbacks,
} from "./missions/mission.js";
import {
  registerFocusPickerSettings,
  registerTalentPickerSettings,
  registerCompendiumPickerMenu,
} from "./settings/pickerSettings.js";
import { getCharacterArcEligibility } from "./arcs/arcChains.js";
import {
  openGMFlow,
  promptCallbackForUserId,
  sendCallbackPromptToUser,
} from "./callback/gmFlow.js";
import { openPendingShipBenefitsDialog } from "./ship/pendingShipBenefitsDialog.js";
import { installRenderApplicationV2Hook } from "./sheet/hook.js";
import { installCreateChatMessageHook } from "./callback/chatMessage.js";
import {
  installReputationSpendHook,
  promptGMSpendDialog,
  triggerAllPlayersAcclaimSurvey,
} from "./acclaim/reputationSpend.js";
import { openGMSurveyMonitor } from "./acclaim/gmSurveyMonitor.js";
import { registerClientSettings } from "./settings/clientSettings.js";
import {
  registerDirectiveSettings,
  getMissionDirectives,
  makeDirectiveValueIdFromText,
} from "./directives/directives.js";
import { registerAcclaimSurveySettings } from "./acclaim/acclaimSurvey.js";
import {
  migrateCustomSpendOptions,
  registerCustomSpendOptionsSettings,
} from "./acclaim/customSpendOptions.js";
import { registerAwardTalentSettings } from "./acclaim/awardTalents.js";
import { registerHouseSettings } from "./house/house-settings.js";
import { warnMissingHouseOwnership } from "./house/house-assignment.js";
import { useValue } from "./values/useValue.js";
import { promptShipTalentChoiceFromCompendium } from "./milestones/talentPickerDialog.js";
import { CreationWizardApp } from "./creation/creation-wizard-app.mjs";
import { preloadCreationTabTemplate } from "./creation/creation-tab.mjs";
import { registerOfficersLogDataModel } from "./data/logDataModel.js";
import { registerOfficersTraitDataModel } from "./data/traitDataModel.js";
import { registerOfficersCharacterDataModel } from "./data/characterDataModel.js";
import { registerHouseDataModel } from "./data/houseDataModel.js";
import { OfficersLogSheet } from "./sheet/OfficersLogSheet.mjs";
import { OfficersTalentSheet } from "./sheet/OfficersTalentSheet.mjs";
import { HouseSheet } from "./house/house-sheet.mjs";
import {
  registerMigrationSetting,
  runLogFlagMigration,
} from "./data/migration.js";
import {
  isMissionLogJournalsEnabled,
  syncAllJournals,
  syncPageForLogItem,
  deletePageForLogItem,
  syncJournalMetadataForActor,
  syncMissionJournalsDebounced,
} from "./journal/index.js";
import { MissionManagerApp } from "./missions/MissionManagerApp.mjs";

function registerApi() {
  // Public API (available on all clients; methods may GM-guard internally)
  game.staofficerslog = {
    open: openGMFlow,
    resetMissionCallbacks,
    promptNewMissionAndReset,
    endCurrentMission,
    reactivateLastEndedMission,
    reactivateMissionFromHistory,
    getMissionHistory,
    removeMissionFromHistory,
    addParticipantToCurrentMission,
    promptAddParticipant,

    // Macro/tooling
    newScene,

    // Expose for socket + tools
    promptCallbackForUserId,
    sendCallbackPromptToUser,

    // Arc tooling
    getCharacterArcEligibility,

    // Small helper for hooks (cheap guard)
    hasUsedCallbackThisMission,

    // Ship benefits review
    reviewPendingShipBenefits: openPendingShipBenefitsDialog,

    // Open Group Ship sheet
    openGroupShip,

    // Pick a starship talent with ship requirements evaluated against the actor.
    pickShipTalent: (actor, options = {}) =>
      promptShipTalentChoiceFromCompendium({
        actor,
        allowCustom: options.allowCustom === true,
      }),

    // Open Mission Manager directly
    openMissionManager: () => new MissionManagerApp().render(true),

    // GM: Send spend dialog to a player
    promptGMSpendDialog,

    // GM: Trigger acclaim survey for all online players
    triggerAllPlayersAcclaimSurvey,

    // GM: Open the survey monitor (works independently of triggering surveys)
    openGMSurveyMonitor,

    // Public API: programmatic value use (for external module integration)
    useValue,

    // Public API: mission directives (for external module integration, e.g. sta-utils dropdown)
    getMissionDirectives,
    makeDirectiveValueIdFromText,

    // Creation in Play wizard
    openCreationWizard: () => new CreationWizardApp().render(true),

    // Optional sheet integrations can subclass this without importing a
    // deployment-root URL from another module.
    HouseSheet,

    openHouse: async (actorOrUuid) => {
      if (!game.user?.isGM) return null;
      const actor =
        typeof actorOrUuid === "string"
          ? await fromUuid(actorOrUuid)
          : actorOrUuid;
      if (actor?.type !== `${MODULE_ID}.house`) return null;
      await actor.sheet?.render(true);
      return actor;
    },

    // Open the requirement-aware talent picker to define a talent on an actor
    openDefineTalentDialog: async (actor) => {
      const { openDefineTalentDialog } =
        await import("./creation/define-dialogs.mjs");
      return openDefineTalentDialog(actor);
    },
  };

  // Back-compat for macros that reference a global symbol.
  globalThis.staofficerslog = game.staofficerslog;
}

function isPrimaryActiveGM() {
  if (!game.user?.isGM) return false;
  const primaryGm = [...(game.users ?? [])]
    .filter((user) => user.active && user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  return primaryGm?.id === game.user.id;
}

function safeInstallUiHooks() {
  try {
    installRenderApplicationV2Hook();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to install render hook`, err);
  }
}

function safeInstallMissionLogJournalHooks() {
  try {
    // createItem / updateItem / deleteItem — surgically sync only the page for
    // the log item that was added, changed, or removed.
    Hooks.on("createItem", (item) => {
      try {
        if (!game.user?.isGM || !isMissionLogJournalsEnabled()) return;
        if (item?.type === "log" && item?.parent?.type === "character") {
          syncPageForLogItem(item.parent, item);
          syncMissionJournalsDebounced();
        }
      } catch (err) {
        console.error(`${MODULE_ID} | createItem journal hook failed`, err);
      }
    });

    Hooks.on("updateItem", (item) => {
      try {
        if (!game.user?.isGM || !isMissionLogJournalsEnabled()) return;
        if (item?.type === "log" && item?.parent?.type === "character") {
          syncPageForLogItem(item.parent, item);
          syncMissionJournalsDebounced();
        }
      } catch (err) {
        console.error(`${MODULE_ID} | updateItem journal hook failed`, err);
      }
    });

    Hooks.on("deleteItem", (item) => {
      try {
        if (!game.user?.isGM || !isMissionLogJournalsEnabled()) return;
        if (item?.type === "log" && item?.parent?.type === "character") {
          deletePageForLogItem(item.parent, item.id);
          syncMissionJournalsDebounced();
        }
      } catch (err) {
        console.error(`${MODULE_ID} | deleteItem journal hook failed`, err);
      }
    });

    // updateActor — keep journal name and ownership in sync when the actor is
    // renamed or its permissions change.  Page content is NOT touched.
    Hooks.on("updateActor", (actor, changes) => {
      try {
        if (!game.user?.isGM || !isMissionLogJournalsEnabled()) return;
        if (actor?.type !== "character") return;
        if ("name" in changes || "ownership" in changes) {
          syncJournalMetadataForActor(actor);
        }
      } catch (err) {
        console.error(`${MODULE_ID} | updateActor journal hook failed`, err);
      }
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to install mission log journal hooks`,
      err,
    );
  }
}

let _chatHooksInstalled = false;

function safeInstallChatHooks() {
  if (_chatHooksInstalled) return;
  try {
    installCreateChatMessageHook();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to install chat hook`, err);
  }

  try {
    installReputationSpendHook();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to install reputation spend hook`,
      err,
    );
  }

  _chatHooksInstalled = true;
}

function safeRegisterSettings() {
  try {
    registerMissionSettings();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register settings`, err);
  }

  try {
    registerMigrationSetting();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register migration setting`, err);
  }

  try {
    registerDirectiveSettings();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register directive settings`, err);
  }

  try {
    registerAcclaimSurveySettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register acclaim survey settings`,
      err,
    );
  }

  try {
    registerCustomSpendOptionsSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register custom spend options settings`,
      err,
    );
  }

  try {
    registerAwardTalentSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register award talent settings`,
      err,
    );
  }

  try {
    registerHouseSettings();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register House settings`, err);
  }

  try {
    registerFocusPickerSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register focus picker settings`,
      err,
    );
  }

  try {
    registerTalentPickerSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register talent picker settings`,
      err,
    );
  }

  try {
    registerCompendiumPickerMenu();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register compendium picker menu`,
      err,
    );
  }
}

function safeRegisterClientSettings() {
  try {
    registerClientSettings();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register client settings`, err);
  }
}

function safeRegisterTemplateHelpers() {
  try {
    if (globalThis.Handlebars?.registerHelper) {
      globalThis.Handlebars.registerHelper("klingonText", (value) =>
        applyKlingonMode(value),
      );
    }
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register template helpers`, err);
  }
}

function safeInitSocket() {
  try {
    initSocket({ CallbackRequestApp });
  } catch (err) {
    console.error(`${MODULE_ID} | initSocket failed`, err);
  }
}

function refreshSceneControls() {
  try {
    // If controls were already built before our hook registered, force refresh.
    ui.controls?.initialize?.();
  } catch (_) {
    // controls may not be ready yet
  }
}

/**
 * Check all actors for pending ship benefits and notify GM if any exist
 */
async function checkPendingShipBenefits() {
  try {
    let totalPending = 0;

    for (const actor of game.actors) {
      if (actor.type !== "character") continue;

      const pending =
        actor.system?.pendingShipBenefits ??
        actor.getFlag(MODULE_ID, "pendingShipBenefits");
      if (pending && Array.isArray(pending) && pending.length > 0) {
        totalPending += pending.length;
      }
    }

    if (totalPending > 0) {
      const notification = ui.notifications.info(
        tf(
          totalPending === 1
            ? "sta-officers-log.notifications.pendingShipBenefitsReview"
            : "sta-officers-log.notifications.pendingShipBenefitsReviewMany",
          { count: totalPending },
        ),
        { permanent: true },
      );

      // Make the notification clickable
      if (notification?.element) {
        notification.element.style.cursor = "pointer";
        notification.element.addEventListener("click", () => {
          openPendingShipBenefitsDialog();
          notification.close();
        });
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | checkPendingShipBenefits failed:`, err);
  }
}

/**
 * Warn the primary GM when Player users cannot create items required by
 * character advancement workflows.
 */
async function warnWhenPlayersCannotCreateItems() {
  const permissions = await game.settings.get("core", "permissions");
  const itemCreateRoles =
    permissions?.ITEM_CREATE ??
    Array.fromRange(CONST.USER_ROLES.GAMEMASTER + 1).slice(
      CONST.USER_PERMISSIONS.ITEM_CREATE.defaultRole,
    );

  if (itemCreateRoles.includes(CONST.USER_ROLES.PLAYER)) return;

  ui.notifications?.warn?.(
    t("sta-officers-log.notifications.playersCannotCreateItems"),
    { permanent: true },
  );
}

// Ensure API exists even if init/ready already fired (late-load resilience)
try {
  registerApi();
} catch (err) {
  console.error(`${MODULE_ID} | failed to register API`, err);
}

Hooks.once("init", () => {
  // Register data models before any settings so system.* fields are available.
  try {
    registerOfficersLogDataModel();
    registerOfficersTraitDataModel();
    registerOfficersCharacterDataModel();
    registerHouseDataModel();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register data model`, err);
  }

  // Register opt-in log sheet (makeDefault:false — existing users unaffected).
  try {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(
      Actor,
      MODULE_ID,
      HouseSheet,
      {
        types: [`${MODULE_ID}.house`],
        label: "House (Officers Log)",
        makeDefault: true,
      },
    );
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register HouseSheet`, err);
  }

  try {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(
      Item,
      MODULE_ID,
      OfficersLogSheet,
      {
        types: ["log"],
        label: "Log (Officers Log)",
        makeDefault: false,
      },
    );
    (foundry.applications.handlebars.loadTemplates ?? loadTemplates)([
      `modules/${MODULE_ID}/templates/officers-log-sheet.hbs`,
      `modules/${MODULE_ID}/templates/officers-talent-sheet.hbs`,
    ]);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register OfficersLogSheet`, err);
  }

  // Register Officers Talent sheet as default for talent items.
  try {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(
      Item,
      MODULE_ID,
      OfficersTalentSheet,
      {
        types: ["talent"],
        label: "Talent (Officers Log)",
        makeDefault: true,
      },
    );
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register OfficersTalentSheet`, err);
  }

  safeRegisterClientSettings();
  safeRegisterTemplateHelpers();
  safeRegisterSettings();

  // Pre-load creation tab template so it renders synchronously on sheet renders.
  preloadCreationTabTemplate();

  // Public API (refresh in case something overwrote it)
  registerApi();

  console.log("sta-officers-log | API registered: game.staofficerslog.open()");

  // Hooks moved out of main.js
  safeInstallUiHooks();
  safeInstallMissionLogJournalHooks();
  safeInstallChatHooks();
});

Hooks.once("ready", async () => {
  console.log(
    `${MODULE_ID} | ready on ${game.user.name} | id=${game.user.id} | GM? ${game.user.isGM}`,
  );

  safeInitSocket();

  // A single deterministic GM runs world migrations. Awaiting them prevents
  // later ready-time work from observing partially migrated documents.
  if (isPrimaryActiveGM()) {
    try {
      await runLogFlagMigration();
      await migrateCustomSpendOptions();
    } catch (err) {
      console.error(`${MODULE_ID} | world migration failed`, err);
      ui.notifications?.error?.(
        "STA Officers Log migration did not finish and will retry next startup. Check the console for details.",
        { permanent: true },
      );
    }

    try {
      await warnMissingHouseOwnership();
    } catch (err) {
      console.error(`${MODULE_ID} | House ownership check failed`, err);
    }

    try {
      await warnWhenPlayersCannotCreateItems();
    } catch (err) {
      console.error(
        `${MODULE_ID} | Item creation permission check failed`,
        err,
      );
    }
  }

  try {
    if (game.user.isGM) ensureNewSceneMacro();
  } catch (err) {
    console.error(`${MODULE_ID} | ensureNewSceneMacro failed`, err);
  }

  // Ensure the group ship actor's prototype token is linked so that
  // actor.update() calls are reflected on all open token sheets.
  try {
    if (game.user.isGM) {
      ensureGroupShipTokenLinked().catch((err) => {
        console.warn(
          `${MODULE_ID} | ensureGroupShipTokenLinked (ready) failed`,
          err,
        );
      });
    }
  } catch (err) {
    console.error(
      `${MODULE_ID} | ensureGroupShipTokenLinked startup failed`,
      err,
    );
  }

  // Check for pending ship benefits and notify GM
  try {
    if (game.user.isGM) checkPendingShipBenefits();
  } catch (err) {
    console.error(`${MODULE_ID} | checkPendingShipBenefits failed`, err);
  }

  // Prompt GM if active players are not yet in the current mission
  try {
    if (game.user.isGM) promptUnaddedActivePlayers();
  } catch (err) {
    console.error(`${MODULE_ID} | promptUnaddedActivePlayers failed`, err);
  }

  // Sync mission log journals on load (GM only, when setting is enabled).
  try {
    if (game.user.isGM && isMissionLogJournalsEnabled()) {
      syncAllJournals().catch((err) => {
        console.error(`${MODULE_ID} | syncAllJournals (ready) failed`, err);
      });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | syncAllJournals startup failed`, err);
  }
});

// When a player connects mid-session, check whether they need to be added to the mission.
Hooks.on("userConnected", (user, active) => {
  try {
    if (!game.user?.isGM) return;
    if (!active) return; // user disconnected — nothing to do
    if (user?.isGM) return;
    // Small delay so Foundry fully settles the user's connected state before we query it.
    setTimeout(() => {
      promptUnaddedActivePlayers().catch((err) => {
        console.error(
          `${MODULE_ID} | promptUnaddedActivePlayers (userConnected) failed`,
          err,
        );
      });
      if (isPrimaryActiveGM()) {
        warnMissingHouseOwnership([user]).catch((err) => {
          console.error(`${MODULE_ID} | House ownership check failed`, err);
        });
      }
    }, 1000);
  } catch (err) {
    console.error(`${MODULE_ID} | userConnected hook failed`, err);
  }
});

// If the module was loaded after init/ready already fired, run best-effort setup.
// This should be rare, but it prevents a "everything is undefined" failure mode.
if (game?.ready) {
  safeRegisterClientSettings();
  safeRegisterTemplateHelpers();
  safeRegisterSettings();
  safeInstallUiHooks();
  safeInstallChatHooks();
  safeInitSocket();
  refreshSceneControls();
}
