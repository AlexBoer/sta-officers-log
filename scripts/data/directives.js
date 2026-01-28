import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

export const MISSION_DIRECTIVES_SETTING = "missionDirectives";

export const DIRECTIVES_SNAPSHOT_FLAG = "directivesSnapshot";
export const DIRECTIVE_LABELS_FLAG = "directiveLabels"; // map key -> display text

export const PRIMARY_DIRECTIVE_KEY_FLAG = "primaryDirectiveKey";

export const DIRECTIVE_VALUE_ID_PREFIX = "directive:";
export const DIRECTIVE_MAX_LEN = 100;

export function directiveIconPath() {
  return `modules/${MODULE_ID}/assets/ValueIcons/Directive.webp`;
}

export function isDirectiveValueId(valueId) {
  return String(valueId ?? "").startsWith(DIRECTIVE_VALUE_ID_PREFIX);
}

export function getDirectiveKeyFromValueId(valueId) {
  const s = String(valueId ?? "");
  return s.startsWith(DIRECTIVE_VALUE_ID_PREFIX)
    ? s.slice(DIRECTIVE_VALUE_ID_PREFIX.length)
    : "";
}

function _stripHtml(input) {
  const raw = String(input ?? "");
  try {
    const div = document.createElement("div");
    div.innerHTML = raw;
    return String(div.textContent ?? "");
  } catch (_err) {
    // Best-effort fallback
    return raw.replace(/<[^>]*>/g, " ");
  }
}

export function sanitizeDirectiveText(input) {
  // No localization needed; this is user-entered.
  let s = _stripHtml(input);
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length > DIRECTIVE_MAX_LEN) s = s.slice(0, DIRECTIVE_MAX_LEN);
  return s;
}

export function base64UrlEncode(str) {
  const s = String(str ?? "");
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(b64url) {
  let b64 = String(b64url ?? "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function makeDirectiveKeyFromText(text) {
  const cleaned = sanitizeDirectiveText(text);
  if (!cleaned) return "";
  return base64UrlEncode(cleaned);
}

export function makeDirectiveValueIdFromText(text) {
  const key = makeDirectiveKeyFromText(text);
  if (!key) return "";
  return `${DIRECTIVE_VALUE_ID_PREFIX}${key}`;
}

export function getDirectiveTextFromLabelsMap(labelsMap, directiveKey) {
  if (!directiveKey) return "";
  const m = labelsMap && typeof labelsMap === "object" ? labelsMap : null;
  const v = m ? m[String(directiveKey)] : null;
  return typeof v === "string" ? v : "";
}

export function getDirectiveTextForValueId(log, directiveValueId) {
  const key = getDirectiveKeyFromValueId(directiveValueId);
  if (!key) return "";

  try {
    const labels = log?.getFlag?.(MODULE_ID, DIRECTIVE_LABELS_FLAG) ?? null;
    const stored = getDirectiveTextFromLabelsMap(labels, key);
    if (stored) return stored;
  } catch (_) {
    // ignore
  }

  // Fallback: decode the key (works for most cases)
  try {
    return sanitizeDirectiveText(base64UrlDecode(key));
  } catch (_) {
    return "";
  }
}

export function getMissionDirectives() {
  try {
    const raw = game.settings.get(MODULE_ID, MISSION_DIRECTIVES_SETTING) ?? [];
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map((s) => String(s)).filter(Boolean);
  } catch (_) {
    return [];
  }
}

export async function setMissionDirectives(list) {
  const arr = Array.isArray(list) ? list : [];
  const cleaned = [];
  const seen = new Set();

  for (const x of arr) {
    const s = sanitizeDirectiveText(x);
    if (!s) continue;
    if (seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    cleaned.push(s);
  }

  await game.settings.set(MODULE_ID, MISSION_DIRECTIVES_SETTING, cleaned);
}

export function getDirectiveSnapshotForLog(log) {
  try {
    const raw = log?.getFlag?.(MODULE_ID, DIRECTIVES_SNAPSHOT_FLAG) ?? [];
    return Array.isArray(raw) ? raw.map((s) => String(s)).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

export async function snapshotDirectivesOntoLog(log, directivesList) {
  if (!log || typeof log.update !== "function") return;
  const cleaned = [];
  const seen = new Set();

  for (const x of directivesList ?? []) {
    const s = sanitizeDirectiveText(x);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(s);
  }

  await log.update({
    [`flags.${MODULE_ID}.${DIRECTIVES_SNAPSHOT_FLAG}`]: cleaned,
  });
}

export function getChallengedDirectivesMap(actor) {
  try {
    const m = actor?.getFlag?.(MODULE_ID, "challengedDirectives") ?? {};
    return m && typeof m === "object" ? m : {};
  } catch (_) {
    return {};
  }
}

export async function setDirectiveChallenged(actor, directiveKey, challenged) {
  if (!actor || !directiveKey) return;
  const map = foundry.utils.deepClone(getChallengedDirectivesMap(actor));
  if (challenged) map[String(directiveKey)] = true;
  else delete map[String(directiveKey)];
  await actor.setFlag(MODULE_ID, "challengedDirectives", map);
}

// --- STA Tracker re-render helper ---

async function rerenderStaTracker() {
  try {
    const Tracker = globalThis?.STATracker;

    const inst = globalThis?.foundry?.applications?.instances;
    const apps = [];
    if (inst) {
      for (const app of inst.values()) apps.push(app);
    }

    const uniq = Array.from(new Set(apps)).filter(Boolean);

    for (const app of uniq) {
      const ctorName = String(app?.constructor?.name ?? "");
      const isTracker =
        ctorName === "STATracker" || (Tracker && app instanceof Tracker);
      if (!isTracker) continue;

      try {
        await app.render?.({ force: true });
      } catch (_) {
        // ignore
      }
    }
  } catch (_) {
    // ignore
  }
}

// --- Settings menu ---

// v13+ ApplicationV2 + HandlebarsApplicationMixin
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DirectiveSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-directive-settings`,
    tag: "form",
    window: {
      title: "sta-officers-log.settings.directives.menuTitle",
      contentClasses: ["standard-form"],
    },
    position: {
      width: 520,
      height: "auto",
    },
    form: {
      closeOnSubmit: true,
      handler: DirectiveSettingsApp.#onSubmit,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/directives-settings.hbs`,
    },
  };

  async _prepareContext(_options) {
    const list = getMissionDirectives();
    return {
      directivesText: list.join("\n"),
      maxLen: DIRECTIVE_MAX_LEN,
    };
  }

  static async #onSubmit(_event, form, formData) {
    const raw = String(formData.object?.directivesText ?? "");
    const lines = raw
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);

    await setMissionDirectives(lines);

    ui.notifications?.info?.(
      t("sta-officers-log.settings.directives.saved") ||
        "Mission directives saved.",
    );

    // Re-render the STA Tracker so the directives section updates.
    rerenderStaTracker();
  }
}

export function registerDirectiveSettings() {
  game.settings.register(MODULE_ID, MISSION_DIRECTIVES_SETTING, {
    name: "Mission Directives",
    hint: "Internal list of mission directives. Use the menu to edit (supports one per line).",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.registerMenu(MODULE_ID, "directiveMenu", {
    name:
      t("sta-officers-log.settings.directives.name") || "Mission Directives",
    label: t("sta-officers-log.settings.directives.label") || "Edit Directives",
    hint:
      t("sta-officers-log.settings.directives.hint") ||
      "Define mission directives that players can choose when using a Directive.",
    icon: "fa-solid fa-flag",
    type: DirectiveSettingsApp,
    restricted: true,
  });
}
