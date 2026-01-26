import { MODULE_ID } from "../core/constants.js";

export const AMBIENT_AUDIO_SELECTION_ONLY_SETTING =
  "playerAmbientAudioSelectionOnly";

let _desiredEnabled = null;

/**
 * Make player ambient audio behave like GM ambient audio:
 * - Ambient sounds only emit when a *controlled/selected* token is nearby.
 * - If no owned/observer token is controlled, the player hears nothing.
 *
 * Foundry's internals vary by major version, so we patch the first supported
 * listener-position method we can find on the Sounds layer.
 */
export function installAmbientAudioSelectionListenerPatch() {
  // Register hooks only once, even if this module is hot-reloaded.
  if (globalThis.__staCallbacksHelperAmbientAudioPatched) return;
  globalThis.__staCallbacksHelperAmbientAudioPatched = true;

  Hooks.once("canvasReady", () => {
    try {
      if (_desiredEnabled === null) _desiredEnabled = _getEnabledSetting();
      _applyPatchState(_desiredEnabled);
    } catch (err) {
      console.error(`${MODULE_ID} | ambient audio patch failed`, err);
    }
  });

  // Keep ambient audio updated as selection changes (players will often toggle selection).
  Hooks.on("controlToken", () => {
    if (game.user?.isGM) return;

    // Only refresh aggressively when the patch is enabled.
    if (_getEnabledSetting()) _safeRefreshSounds("token control changed");
  });
}

/**
 * Apply the configured patch state immediately.
 * Call this from a game setting onChange handler.
 */
export function setPlayerAmbientAudioSelectionOnlyEnabled(enabled) {
  _desiredEnabled = Boolean(enabled);
  _applyPatchState(_desiredEnabled);
}

function _getEnabledSetting() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, AMBIENT_AUDIO_SELECTION_ONLY_SETTING),
    );
  } catch (_) {
    return Boolean(_desiredEnabled);
  }
}

function _applyPatchState(enabled) {
  // If canvas isn't ready yet, defer.
  if (!canvas?.ready) {
    _desiredEnabled = Boolean(enabled);
    return;
  }

  if (enabled) {
    _patchSoundsLayerListenerPositions();
    _safeRefreshSounds("ambient audio patch enabled");
    return;
  }

  _unpatchSoundsLayerListenerPositions();
  _safeRefreshSounds("ambient audio patch disabled");
}

function _patchSoundsLayerListenerPositions() {
  const soundsLayer = canvas?.sounds;
  if (!soundsLayer) {
    console.warn(
      `${MODULE_ID} | canvas.sounds not found; cannot patch ambient audio`,
    );
    return;
  }

  const methodName = ["_getListenerPositions", "getListenerPositions"].find(
    (n) => typeof soundsLayer[n] === "function",
  );

  if (!methodName) {
    console.warn(
      `${MODULE_ID} | No supported listener-position method found on canvas.sounds; ambient audio patch skipped`,
    );
    return;
  }

  const original = soundsLayer[methodName];
  if (original?.__staCallbacksHelperPatched) return;

  function wrapped(...args) {
    // Preserve GM behavior entirely.
    const positions = original.apply(this, args);
    if (game.user?.isGM) return positions;

    // Match the GM default: only controlled tokens act as listeners.
    const controlled = canvas?.tokens?.controlled ?? [];
    const listeners = controlled.filter(_userCanObserveToken);

    if (!listeners.length) return [];

    return listeners
      .map((t) => {
        const center = t.center ?? {
          x: (t.x ?? 0) + (t.w ?? 0) / 2,
          y: (t.y ?? 0) + (t.h ?? 0) / 2,
        };
        const p = { x: center.x, y: center.y };

        const elevation = t.document?.elevation;
        if (Number.isFinite(elevation)) p.elevation = elevation;

        return p;
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }

  wrapped.__staCallbacksHelperPatched = true;
  wrapped.__staCallbacksHelperOriginal = original;

  soundsLayer[methodName] = wrapped;

  console.log(
    `${MODULE_ID} | ambient audio patched: canvas.sounds.${methodName} now uses controlled tokens for players`,
  );
}

function _unpatchSoundsLayerListenerPositions() {
  const soundsLayer = canvas?.sounds;
  if (!soundsLayer) return;

  for (const methodName of ["_getListenerPositions", "getListenerPositions"]) {
    const fn = soundsLayer?.[methodName];
    if (!fn?.__staCallbacksHelperPatched) continue;

    const original = fn.__staCallbacksHelperOriginal;
    if (typeof original === "function") {
      soundsLayer[methodName] = original;
      console.log(
        `${MODULE_ID} | ambient audio unpatched: restored canvas.sounds.${methodName}`,
      );
    }
  }
}

function _userCanObserveToken(token) {
  if (!token) return false;

  // Fast path.
  if (token.isOwner) return true;

  const doc = token.document;
  const user = game.user;
  const test = doc?.testUserPermission;
  if (typeof test !== "function") return false;

  // Foundry versions differ on whether permission is string vs numeric.
  try {
    return !!test.call(doc, user, "OBSERVER");
  } catch (_) {
    // ignore
  }

  try {
    const lvl = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER;
    if (lvl == null) return false;
    return !!test.call(doc, user, lvl);
  } catch (_) {
    return false;
  }
}

function _safeRefreshSounds(reason) {
  try {
    // Different Foundry versions use different refresh hooks.
    canvas?.sounds?.refresh?.();
    canvas?.sounds?._refresh?.();
    canvas?.perception?.update?.({ refreshSounds: true });
  } catch (err) {
    console.debug(`${MODULE_ID} | sound refresh skipped (${reason})`, err);
  }
}
