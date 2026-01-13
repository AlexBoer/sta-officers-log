import { CallbackRequestApp } from "./CallbackRequestApp.js";
import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";
import { initSocket } from "./socket.js";
import {
  AMBIENT_AUDIO_SELECTION_ONLY_SETTING,
  installAmbientAudioSelectionListenerPatch,
  setPlayerAmbientAudioSelectionOnlyEnabled,
} from "./ambientAudioPatch.js";
import {
  addParticipantToCurrentMission,
  ensureNewSceneMacro,
  hasUsedCallbackThisMission,
  newScene,
  promptAddParticipant,
  promptNewMissionAndReset,
  registerMissionSettings,
  resetMissionCallbacks,
} from "./mission.js";
import {
  registerFocusPickerSettings,
  registerTalentPickerSettings,
} from "./focusPickerSettings.js";
import { getCharacterArcEligibility } from "./arcChains.js";
import {
  openGMFlow,
  promptCallbackForUserId,
  setPendingResponses,
} from "./callbackFlow.js";
import {
  installCreateChatMessageHook,
  installRenderApplicationV2Hook,
} from "./sheetHooks.js";
import { registerClientSettings } from "./clientSettings.js";

/** @type {Map<string, Function>} */
const pendingResponses = new Map();
setPendingResponses(pendingResponses);

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

    // Arc tooling
    getCharacterArcEligibility,

    // Small helper for hooks (cheap guard)
    hasUsedCallbackThisMission,
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
    registerFocusPickerSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register focus picker settings`,
      err
    );
  }

  try {
    registerTalentPickerSettings();
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register talent picker settings`,
      err
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
            err
          );
        }
      },
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to register ambient audio settings`,
      err
    );
  }
}

function safeInitSocket() {
  try {
    initSocket({ CallbackRequestApp, pendingResponses });
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
    "sta-officers-log | API registered: game.staCallbacksHelper.open()"
  );

  // Hooks moved out of main.js
  safeInstallUiHooks();
});

Hooks.once("ready", () => {
  console.log(
    `${MODULE_ID} | ready on ${game.user.name} | id=${game.user.id} | GM? ${game.user.isGM}`
  );

  safeInitSocket();

  try {
    if (game.user.isGM) ensureNewSceneMacro();
  } catch (err) {
    console.error(`${MODULE_ID} | ensureNewSceneMacro failed`, err);
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
