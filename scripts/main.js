import { CallbackRequestApp } from "./callbackFlow/CallbackRequestApp.js";
import { MODULE_ID, t, initSocket } from "./core/index.js";
import { warpCalculator } from "./warpCalculator.js";
import {
  addParticipantToCurrentMission,
  ensureNewSceneMacro,
  hasUsedCallbackThisMission,
  newScene,
  promptAddParticipant,
  promptNewMissionAndReset,
  registerMissionSettings,
  resetMissionCallbacks,
} from "./data/mission.js";
import {
  registerFocusPickerSettings,
  registerTalentPickerSettings,
} from "./settings/pickerSettings.js";
import { getCharacterArcEligibility } from "./data/arcChains.js";
import {
  openGMFlow,
  promptCallbackForUserId,
  sendCallbackPromptToUser,
  openPendingShipBenefitsDialog,
} from "./callbackFlow.js";
import {
  AMBIENT_AUDIO_SELECTION_ONLY_SETTING,
  installAmbientAudioSelectionListenerPatch,
  installCreateChatMessageHook,
  installMacroActorImageHook,
  installRenderApplicationV2Hook,
  installStressMonitoringHook,
  setPlayerAmbientAudioSelectionOnlyEnabled,
} from "./hooks/index.js";
import { registerClientSettings } from "./settings/clientSettings.js";
import { registerDirectiveSettings } from "./data/directives.js";

function registerApi() {
  // Public API (available on all clients; methods may GM-guard internally)
  game.staCallbacksHelper = {
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

    // Warp Speed Calculator
    warpCalculator,
  };

  // Back-compat for macros that reference a global symbol.
  globalThis.staCallbacksHelper = game.staCallbacksHelper;
}

function safeInstallUiHooks() {
  try {
    installRenderApplicationV2Hook();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to install render hook`, err);
  }

  try {
    installStressMonitoringHook();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to install stress monitoring hook`,
      err,
    );
  }

  try {
    installMacroActorImageHook();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to install macro actor image hook`,
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

function safeRegisterAmbientAudioSettings() {
  try {
    game.settings.register(MODULE_ID, AMBIENT_AUDIO_SELECTION_ONLY_SETTING, {
      name: t("sta-officers-log.settings.playerAmbientAudioSelectionOnly.name"),
      hint: t("sta-officers-log.settings.playerAmbientAudioSelectionOnly.hint"),
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
      onChange: (value) => {
        try {
          setPlayerAmbientAudioSelectionOnlyEnabled(Boolean(value));
        } catch (err) {
          console.error(
            `${MODULE_ID} | ambient audio setting onChange failed`,
            err,
          );
        }
      },
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register ambient audio settings`,
      err,
    );
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
    // ignore
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
  safeRegisterAmbientAudioSettings();
  installAmbientAudioSelectionListenerPatch();

  // Public API (refresh in case something overwrote it)
  registerApi();

  console.log(
    "sta-officers-log | API registered: game.staCallbacksHelper.open()",
  );

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
  safeRegisterAmbientAudioSettings();
  installAmbientAudioSelectionListenerPatch();
  safeInstallUiHooks();
  safeInstallChatHooks();
  safeInitSocket();
  refreshSceneControls();
}
