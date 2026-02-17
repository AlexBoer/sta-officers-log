import { CallbackRequestApp } from "./callback/CallbackRequestApp.js";
import { MODULE_ID, t, initSocket } from "./core/index.js";
import {
  addParticipantToCurrentMission,
  ensureNewSceneMacro,
  ensureOpenGroupShipMacro,
  hasUsedCallbackThisMission,
  newScene,
  openGroupShip,
  promptAddParticipant,
  promptNewMissionAndReset,
  registerMissionSettings,
  resetMissionCallbacks,
} from "./missions/mission.js";
import {
  registerFocusPickerSettings,
  registerTalentPickerSettings,
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
import { registerDirectiveSettings } from "./directives/directives.js";
import { registerAcclaimSurveySettings } from "./acclaim/acclaimSurvey.js";
import { registerCustomSpendOptionsSettings } from "./acclaim/customSpendOptions.js";

function registerApi() {
  // Public API (available on all clients; methods may GM-guard internally)
  game.staofficerslog = {
    open: openGMFlow,
    resetMissionCallbacks,
    promptNewMissionAndReset,
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

      const pending = actor.getFlag(MODULE_ID, "pendingShipBenefits");
      if (pending && Array.isArray(pending) && pending.length > 0) {
        totalPending += pending.length;
      }
    }

    if (totalPending > 0) {
      const notification = ui.notifications.info(
        `${totalPending} pending ship benefit${
          totalPending === 1 ? "" : "s"
        } to review. Click here to review them.`,
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
  safeRegisterClientSettings();
  safeRegisterSettings();

  // Public API (refresh in case something overwrote it)
  registerApi();

  console.log("sta-officers-log | API registered: game.staofficerslog.open()");

  // Hooks moved out of main.js
  safeInstallUiHooks();
});

Hooks.once("ready", () => {
  console.log(
    `${MODULE_ID} | ready on ${game.user.name} | id=${game.user.id} | GM? ${game.user.isGM}`,
  );

  safeInitSocket();

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

  // Hooks moved out of main.js
  safeInstallChatHooks();
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
