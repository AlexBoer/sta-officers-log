import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";

const SPECIES_FOCUS_NAMES = new Set(
  [
    "Human",
    "Vulcan",
    "Denobulan",
    "Romulan",
    "Andorian",
    "Bajoran",
    "Betazoid",
    "Borg",
    "Cardassian",
    "Dominion",
    "Ferengi",
    "Klingon",
    "Tellarite",
    "Trill",
  ].map((s) => s.toLowerCase()),
);

const _normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

function _staUtilsFocusPicker() {
  if (!game.modules?.get?.("sta-utils")?.active) return null;
  const fn = game.staUtils?.focusPicker ?? game.staUtils?.talentPicker;
  return typeof fn === "function" ? fn : null;
}

export function isFocusBrowserPickerAvailable() {
  return Boolean(_staUtilsFocusPicker());
}

// Derives a category from the focus image/name (mirrors the legacy focus picker).
function _deriveFocusCategory(img, name) {
  const n = _normalize(name);
  if (n && SPECIES_FOCUS_NAMES.has(n)) {
    return { key: "species", label: "Species" };
  }

  const raw = String(img ?? "");
  if (!raw) return { key: "misc", label: "Miscellaneous" };

  const lower = raw.toLowerCase();
  if (
    lower.includes("/species/") ||
    lower.includes("species-") ||
    lower.includes("species_") ||
    lower.includes("-species") ||
    lower.includes("_species")
  ) {
    return { key: "species", label: "Species" };
  }

  const file = raw.split("/").pop() ?? raw;
  const base = file.replace(/\.[a-z0-9]+$/i, "").replace(/^focus[-_]/i, "");
  const label = base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const key = (label || base || "misc").toLowerCase();
  return { key, label: label || "Miscellaneous" };
}

function _sourceLabelFromUuid(uuid) {
  const raw = String(uuid ?? "");
  if (!raw.startsWith("Compendium.")) return "";
  const parts = raw.slice("Compendium.".length).split(".");
  if (parts.length < 2) return "";
  const collection = `${parts[0]}.${parts[1]}`;
  const pack = game.packs?.get?.(collection);
  return String(pack?.title ?? pack?.metadata?.label ?? collection);
}

function _descriptionText(item) {
  const description =
    item?.system?.description?.value ?? item?.system?.description ?? "";
  const html = String(description ?? "");
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return String(tmp.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// Attempts the browser-styled focus picker. Returns:
//   { fallback: true }               → sta-utils unavailable, use legacy picker
//   { chosen: null }                 → user cancelled
//   { chosen: { custom: true } }     → user chose "Create Custom Focus"
//   { chosen: <legacy focus shape> } → selected focus
export async function runFocusBrowserPicker({
  focuses = [],
  allowCustom = true,
} = {}) {
  const focusPicker = _staUtilsFocusPicker();
  if (!focusPicker) return { fallback: true };

  const list = Array.isArray(focuses) ? focuses : [];

  // Merge small categories into Miscellaneous (except Species), like the legacy picker.
  const counts = new Map();
  const derived = list.map((focus) => {
    const cat = _deriveFocusCategory(focus?.img, focus?.name);
    counts.set(cat.key, (counts.get(cat.key) ?? 0) + 1);
    return { focus, cat };
  });

  const items = derived.map(({ focus, cat }) => {
    let group = cat;
    if (cat.key !== "species" && (counts.get(cat.key) ?? 0) <= 3) {
      group = { key: "misc", label: "Miscellaneous" };
    }
    return {
      uuid: focus?.uuid ?? null,
      name: focus?.name ?? "",
      img: focus?.img ?? null,
      source: _sourceLabelFromUuid(focus?.uuid),
      descriptionText: _descriptionText(focus?.item),
      group,
      tag: group.label,
      data: {
        name: focus?.name ?? "",
        img: focus?.img ?? null,
        uuid: focus?.uuid ?? null,
        item: focus?.item ?? null,
      },
    };
  });

  const heading = t("sta-officers-log.dialog.focusPicker.heading");
  const result = await focusPicker({
    title: heading,
    heading,
    categoryLabel: t("sta-officers-log.dialog.focusPicker.category"),
    eligibility: false,
    allowCustom: allowCustom !== false,
    talents: items,
  });

  if (!result) return { chosen: null };
  if (result.custom) return { chosen: { custom: true } };
  return { chosen: result.talent ?? null };
}
