import { MODULE_ID, WORLD_ENABLE_KLINGON_MODE_SETTING } from "./constants.js";

const KLINGON_REPLACEMENTS = [
  [/\bDirectives\b/gi, "Dictates"],
  [/\bDirective\b/gi, "Dictate"],
  [/\bAcclaim\b/gi, "Glory"],
  [/\bReprimands\b/gi, "Shame"],
  [/\bReprimand\b/gi, "Shame"],
];

export function isKlingonModeEnabled() {
  try {
    return Boolean(
      game.settings.get(MODULE_ID, WORLD_ENABLE_KLINGON_MODE_SETTING),
    );
  } catch (_) {
    return false;
  }
}

export function applyKlingonMode(value) {
  const text = String(value ?? "");
  if (!text || !isKlingonModeEnabled()) return text;

  let result = text;
  for (const [pattern, replacement] of KLINGON_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function t(key) {
  return applyKlingonMode(game.i18n?.localize?.(key) ?? key);
}

export function tf(key, data) {
  return applyKlingonMode(game.i18n?.format?.(key, data) ?? key);
}
