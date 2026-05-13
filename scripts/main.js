import { CallbackRequestApp } from "./callback/CallbackRequestApp.js";
import { MODULE_ID, t, tf, initSocket } from "./core/index.js";
import {
  addParticipantToCurrentMission,
  endCurrentMission,
  ensureNewSceneMacro,
  ensureOpenGroupShipMacro,
  hasUsedCallbackThisMission,
  newScene,
  openGroupShip,
  promptAddParticipant,
  promptNewMissionAndReset,
  promptUnaddedActivePlayers,
  registerMissionSettings,
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
import { registerCustomSpendOptionsSettings } from "./acclaim/customSpendOptions.js";
import { useValue } from "./values/useValue.js";
import { CreationWizardApp } from "./creation/creation-wizard-app.mjs";
import { preloadCreationTabTemplate } from "./creation/creation-tab.mjs";
import { registerOfficersLogDataModel } from "./data/logDataModel.js";
import { registerOfficersTraitDataModel } from "./data/traitDataModel.js";
import { registerOfficersCharacterDataModel } from "./data/characterDataModel.js";
import { OfficersLogSheet } from "./sheet/OfficersLogSheet.mjs";
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

function registerApi() {
  // Public API (available on all clients; methods may GM-guard internally)
  game.staofficerslog = {
    open: openGMFlow,
    resetMissionCallbacks,
    promptNewMissionAndReset,
    endCurrentMission,
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
  };

  // Back-compat for macros that reference a global symbol.
  globalThis.staofficerslog = game.staofficerslog;
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

function safeInstallChatHooks() {
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
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register data model`, err);
  }

  // Register opt-in log sheet (makeDefault:false — existing users unaffected).
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
    loadTemplates([`modules/${MODULE_ID}/templates/officers-log-sheet.hbs`]);
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register OfficersLogSheet`, err);
  }

  safeRegisterClientSettings();
  safeRegisterSettings();

  // Pre-load creation tab template so it renders synchronously on sheet renders.
  preloadCreationTabTemplate();

  // Public API (refresh in case something overwrote it)
  registerApi();

  console.log("sta-officers-log | API registered: game.staofficerslog.open()");

  // Hooks moved out of main.js
  safeInstallUiHooks();
  safeInstallMissionLogJournalHooks();
});

Hooks.once("ready", () => {
  console.log(
    `${MODULE_ID} | ready on ${game.user.name} | id=${game.user.id} | GM? ${game.user.isGM}`,
  );

  safeInitSocket();

  // Migrate flag data → system fields (GM only, runs once per world).
  try {
    if (game.user.isGM) {
      runLogFlagMigration().catch((err) => {
        console.error(`${MODULE_ID} | data migration failed`, err);
      });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | data migration startup failed`, err);
  }

  try {
    if (game.user.isGM) ensureNewSceneMacro();
  } catch (err) {
    console.error(`${MODULE_ID} | ensureNewSceneMacro failed`, err);
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

  // Hooks moved out of main.js
  safeInstallChatHooks();

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
    }, 1000);
  } catch (err) {
    console.error(`${MODULE_ID} | userConnected hook failed`, err);
  }
});

// If the module was loaded after init/ready already fired, run best-effort setup.
// This should be rare, but it prevents a "everything is undefined" failure mode.
if (game?.ready) {
  safeRegisterClientSettings();
  safeRegisterSettings();
  safeInstallUiHooks();
  safeInstallChatHooks();
  safeInitSocket();
  refreshSceneControls();
}
