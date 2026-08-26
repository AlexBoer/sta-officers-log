import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { escapeHTML, isPlainObject } from "../core/utils.js";
import {
  getNormalizedTalentRequirements,
  humanizeRequirementValue,
  normalizeRequirementString,
  resolveAttributeKey,
  resolveDisciplineKey,
} from "../core/talentRequirements.js";
import {
  getTalentPickerCustomCompendiumKeys,
  getTalentPickerIncludeBuiltinEnabled,
} from "../settings/pickerSettings.js";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_KEYS,
  DISCIPLINE_LABELS,
} from "./dialogs.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

const SPECIES_TALENT_NAMES = new Set(
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
  ].map((name) => name.toLowerCase()),
);

// STA v2.4.6+: talents are stored in sta.items-1e / sta.items-2e.
// Backward-compatible (STA v2.4.5): talents were stored across multiple packs.
//
// NOTE: Order matters. When de-duping by name, later packs win.
// Place 2e after 1e so 2e overrides on collisions.
export const TALENT_BASE_PACKS = [
  // STA v2.4.5 legacy packs (crew)
  "sta.species-talents-core",
  "sta.general-talents-core",
  "sta.discipline-talents-core",
  "sta.talents-crew",
  // STA v2.4.6+ consolidated packs
  "sta.items-1e",
  "sta.items-2e",
];

export const SHIP_TALENT_BASE_PACKS = [
  // STA v2.4.5 legacy packs (ship)
  "sta.starship-talents-core",
  "sta.talents-starship",
  // STA v2.4.6+ consolidated packs
  "sta.items-1e",
  "sta.items-2e",
];

// Kept for weighting: when present, prefer 2e as the "tie-break" source.
const TALENT_CREW_PACK = "sta.items-2e";

// Takes a image and returns a key and a lebla for a cateogry
// eg. engineering-talent.svg -> {key, label: "Engineering"}
function _deriveTalentCategoryFromImg(img, talentName) {
  const name = String(talentName ?? "")
    .trim()
    .toLowerCase();
  if (name && SPECIES_TALENT_NAMES.has(name)) {
    return { key: "species", label: "Species", img: String(img ?? "") };
  }

  const raw = String(img ?? "");
  if (!raw) return { key: "misc", label: "Misc", img: null };

  const lower = raw.toLowerCase();
  if (
    lower.includes("/species/") ||
    lower.includes("species-") ||
    lower.includes("species_") ||
    lower.includes("-species") ||
    lower.includes("_species")
  ) {
    return { key: "species", label: "Species", img: raw };
  }

  const file = raw.split("/").pop() ?? raw;
  const base = file.replace(/\.[a-z0-9]+$/i, "");
  const normalized = base.replace(/^talent[-_]/i, "");
  const label = normalized
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const key = (label || normalized || base || "misc").toLowerCase();
  return { key, label: label || "Misc", img: raw };
}

export async function loadTalentPickerTalents(options = {}) {
  return _collectTalentPickerEntries(options);
}

// Derives the picker group for a talent entry. Species grouping keys off the
// talent's species *requirement* (from the requirements flag / legacy inference),
// not the talent type.
function _deriveCategoryFromEntry(entry) {
  const requirements = getNormalizedTalentRequirements(entry, {
    inferSpecies: _inferRequiredSpeciesFromTalent,
  });
  const speciesReq = requirements.find(
    (r) => normalizeRequirementString(r?.category) === "species",
  );
  if (speciesReq) {
    const rawLabel = (
      Array.isArray(speciesReq.clauses) ? speciesReq.clauses : []
    )
      .map((c) => String(c?.value ?? "").trim())
      .filter(Boolean)
      .join(", ");
    const label = humanizeRequirementValue(rawLabel) || "Species";
    const key = `species:${normalizeRequirementString(rawLabel) || "species"}`;
    return { key, label, img: null, isSpeciesGroup: true };
  }

  const cat = _deriveTalentCategoryFromImg(entry?.img, entry?.name);
  return { ...cat, isSpeciesGroup: cat.key === "species" };
}

// Talent types never offered as an advancement choice in any picker.
const NEVER_PICKABLE_TYPES = new Set([
  "role",
  "speciesability",
  "npc",
  "award",
]);
// Character advancement additionally excludes all ship talents.
const CHARACTER_EXCLUDED_TYPES = new Set([
  ...NEVER_PICKABLE_TYPES,
  "starship",
  "starshipservicerecord",
  "starshipspecialrule",
]);
// Ship advancement shows "starship" talents but not service records / special rules.
const SHIP_EXCLUDED_TYPES = new Set([
  ...NEVER_PICKABLE_TYPES,
  "starshipservicerecord",
  "starshipspecialrule",
]);

export function prepareTalentPickerContext(
  talents = [],
  actor = null,
  options = {},
) {
  const showCustomButton = options.showCustomButton !== false;
  const excludedTypes =
    options.pickerKind === "ship"
      ? SHIP_EXCLUDED_TYPES
      : CHARACTER_EXCLUDED_TYPES;
  const groupsMap = new Map();
  const speciesImgCounts = new Map();
  for (const talent of Array.isArray(talents) ? talents : []) {
    const talentType = normalizeRequirementString(talent?.talenttype?.typeenum);
    if (excludedTypes.has(talentType)) continue;

    const cat = _deriveCategoryFromEntry(talent);
    const requirementLabel = formatTalentRequirementLabel(
      talent?.talenttype,
      talent,
    );
    const meets = doesActorMeetTalentRequirements(actor, talent);
    const entry = {
      name: talent.name,
      img: talent.img,
      uuid: talent.uuid,
      lcName: String(talent.name ?? "").toLowerCase(),
      meetsRequirements: meets,
      requirementLabel,
    };

    if (!groupsMap.has(cat.key)) {
      groupsMap.set(cat.key, {
        key: cat.key,
        label: cat.label,
        img: cat.img,
        isSpeciesGroup: Boolean(cat.isSpeciesGroup),
        items: [],
      });
    }
    groupsMap.get(cat.key).items.push(entry);

    if (cat.isSpeciesGroup) {
      const img = String(entry.img ?? "").trim();
      if (img) {
        if (!speciesImgCounts.has(cat.key)) {
          speciesImgCounts.set(cat.key, new Map());
        }
        const counts = speciesImgCounts.get(cat.key);
        counts.set(img, (counts.get(img) ?? 0) + 1);
      }
    }
  }

  const ROLE_GROUP_KEY = "role";
  const ROLE_GROUP_LABEL = "Role";
  const roleGroup = groupsMap.get(ROLE_GROUP_KEY) ?? {
    key: ROLE_GROUP_KEY,
    label: ROLE_GROUP_LABEL,
    img: null,
    items: [],
  };
  for (const [key, group] of Array.from(groupsMap.entries())) {
    if (group.isSpeciesGroup || key === ROLE_GROUP_KEY) continue;
    const label = String(group.label ?? "").toLowerCase();
    if (label.includes("role") || key.includes("role")) {
      roleGroup.items.push(...group.items);
      groupsMap.delete(key);
    }
  }
  // Always exclude role talents from the picker.
  groupsMap.delete(ROLE_GROUP_KEY);

  const MISC_GROUP_KEY = "misc";
  const MISC_GROUP_LABEL = "Miscellaneous";
  const miscGroup = groupsMap.get(MISC_GROUP_KEY) ?? {
    key: MISC_GROUP_KEY,
    label: MISC_GROUP_LABEL,
    img: null,
    items: [],
  };
  if (!groupsMap.has(MISC_GROUP_KEY)) {
    groupsMap.set(MISC_GROUP_KEY, miscGroup);
  }
  miscGroup.label = MISC_GROUP_LABEL;
  for (const [key, group] of Array.from(groupsMap.entries())) {
    if (
      group.isSpeciesGroup ||
      key === ROLE_GROUP_KEY ||
      key === MISC_GROUP_KEY
    )
      continue;
    if ((group.items?.length ?? 0) < 3) {
      miscGroup.items.push(...group.items);
      groupsMap.delete(key);
    }
  }

  for (const [key, group] of Array.from(groupsMap.entries())) {
    if (!group.isSpeciesGroup) continue;
    const counts = speciesImgCounts.get(key);
    if (!counts || counts.size === 0) continue;
    let bestImg = null;
    let bestCount = 0;
    for (const [img, count] of counts.entries()) {
      if (count > bestCount) {
        bestImg = img;
        bestCount = count;
      }
    }
    if (bestImg) {
      group.img = bestImg;
    }
  }

  const groups = Array.from(groupsMap.values());
  for (const group of groups) {
    group.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  groups.sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return {
    searchLabel: t("sta-officers-log.dialog.talentPicker.search") ?? "Search",
    searchPlaceholder:
      t("sta-officers-log.dialog.talentPicker.searchPlaceholder") ??
      "Type to filter talents…",
    createCustomLabel:
      t("sta-officers-log.dialog.talentPicker.createCustom") ??
      "Create Custom Talent",
    eligibleLabel:
      t("sta-officers-log.dialog.talentPicker.eligibleOnly") ??
      "Only show talents I qualify for",
    emptyLabel:
      t("sta-officers-log.dialog.talentPicker.none") ?? "No talents found.",
    groups,
    showCustomButton,
  };
}

export function bindTalentPickerInteractions(
  root,
  talents = [],
  { onChoose = null, onPreview = null, onCancel = null, onCustom = null } = {},
) {
  if (!root) return { applyFilter: () => {} };
  if (root.dataset.staTalentPickerBound === "1") {
    return { applyFilter: () => {} };
  }
  root.dataset.staTalentPickerBound = "1";

  const listItems = Array.from(
    root.querySelectorAll(".sta-focus-picker-item[data-name]"),
  );
  const groupEls = Array.from(
    root.querySelectorAll(".sta-focus-picker-group[data-group]"),
  );
  const countEl = root.querySelector('[data-hook="foundCount"]');
  const eligibleToggle = root.querySelector('input[name="eligibleOnly"]');

  // Track current search state for the eligibility toggle to use
  let currentQuery = "";
  let currentRgx = null;

  const applyFilter = (query, rgx) => {
    // Update tracked state if provided (from SearchFilter callback)
    if (query !== undefined) currentQuery = query;
    if (rgx !== undefined) currentRgx = rgx;

    const showEligibleOnly = Boolean(eligibleToggle?.checked);

    for (const li of listItems) {
      const name = String(li.dataset.name ?? "");
      const match =
        !currentQuery ||
        foundry.applications.ux.SearchFilter.testQuery(currentRgx, name);
      const meets = li.dataset.meets === "true";
      const failsEligibility = showEligibleOnly && !meets;
      if (match && !failsEligibility) {
        li.style.display = "";
      } else {
        li.style.display = "none";
      }
    }

    for (const g of groupEls) {
      const anyVisible = Array.from(
        g.querySelectorAll(".sta-focus-picker-item"),
      ).some((li) => li.style.display !== "none");
      g.style.display = anyVisible ? "" : "none";
    }

    if (countEl) {
      const visible = listItems.filter(
        (li) => li.style.display !== "none",
      ).length;
      const key = "sta-officers-log.dialog.talentPicker.found";
      const formatted = tf(key, { count: visible });
      if (formatted && formatted !== key) {
        countEl.textContent = formatted;
      } else {
        const template = t(key) ?? "Found: {count}";
        countEl.textContent = String(template).replace(
          "{count}",
          String(visible),
        );
      }
    }
  };

  // Use Foundry's SearchFilter for debounced, standardized filtering
  const searchFilter = new foundry.applications.ux.SearchFilter({
    inputSelector: 'input[name="q"]',
    contentSelector: ".sta-focus-picker-list",
    callback: (_event, query, rgx, _content) => applyFilter(query, rgx),
  });
  searchFilter.bind(root);

  // Eligibility toggle reapplies filter with current search state
  eligibleToggle?.addEventListener("change", () => applyFilter());

  const lookup = new Map();
  for (const talent of Array.isArray(talents) ? talents : []) {
    const uuid = String(talent?.uuid ?? "");
    if (uuid) lookup.set(uuid, talent);
  }

  const handlePreview = async (entry, button) => {
    if (onPreview) {
      await onPreview(entry, button);
      return;
    }
    const title =
      String(button?.getAttribute("data-name") ?? "") ||
      t("sta-officers-log.dialog.talentPicker.previewTitle") ||
      "Talent Preview";
    const desc = await _getTalentDescription(String(entry?.uuid ?? ""));
    await foundry.applications.api.DialogV2.wait({
      classes: ["sta-officers-log"],
      window: { title },
      content: `<div class="sta-talent-preview-dialog">${
        desc || "<p>No description available.</p>"
      }</div>`,
      buttons: [
        {
          action: "close",
          label:
            t("sta-officers-log.dialog.talentPicker.previewClose") ?? "Close",
        },
      ],
      rejectClose: true,
      modal: true,
    });
  };

  root.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!(btn instanceof HTMLButtonElement)) return;

    const action = String(btn.getAttribute("data-action") ?? "");
    if (!action) return;

    ev.preventDefault();
    ev.stopPropagation();

    if (action === "custom") {
      if (onCustom) {
        await onCustom(btn);
      }
      return;
    }

    const item = btn.closest(".sta-focus-picker-item");
    const uuid = String(item?.dataset?.uuid ?? "").trim();
    const talentEntry = lookup.get(uuid) ?? null;
    const entry = {
      name: String(btn.getAttribute("data-name") ?? "").trim(),
      img: String(btn.getAttribute("data-img") ?? "").trim(),
      uuid,
      item: talentEntry?.item ?? null,
      talenttype: talentEntry?.talenttype ?? null,
    };

    if (action === "preview") {
      await handlePreview(entry, btn);
      return;
    }

    if (action === "cancel") {
      if (onCancel) onCancel();
      return;
    }

    if (action === "choose") {
      const rawDescription =
        _extractTalentDescription(entry?.item) ??
        (entry?.uuid ? await _getTalentDescription(entry.uuid) : null);
      const confirmed = await _confirmTalentChoice({
        name: entry?.name,
        description: _descriptionHtmlToText(rawDescription),
      });
      if (!confirmed) return;

      if (onChoose) {
        await onChoose(entry, btn);
      }
      return;
    }
  });

  return { applyFilter: () => applyFilter() };
}

// ensures the index of Talents is an array.
function _normalizeIndexEntries(indexLike) {
  if (!indexLike) return [];
  if (Array.isArray(indexLike)) return indexLike;

  const contents = indexLike.contents;
  if (Array.isArray(contents)) return contents;

  try {
    if (typeof indexLike.values === "function") {
      return Array.from(indexLike.values());
    }
  } catch (_) {
    // ignore
  }

  return [];
}

async function _getTalentIndexEntries({ packKey = "" } = {}) {
  const key = String(packKey ?? "").trim();
  if (!key) return { entries: [], error: "Missing compendium pack key" };

  const pack = game.packs?.get?.(key) ?? null;
  if (!pack) return { entries: [], error: `Missing compendium pack: ${key}` };

  try {
    if (typeof pack.getIndex === "function") {
      // Include folder so we can filter Crew vs Starship in consolidated packs.
      await pack.getIndex({
        fields: ["name", "img", "type", "uuid", "folder"],
      });
    }
  } catch (_) {
    // ignore - we can still try pack.index
  }

  // Ensure pack.folders is populated for folder classification.
  // getIndex() doesn't automatically load the folders collection in Foundry v12+.
  // Loading a single document from the pack triggers folder hierarchy population.
  try {
    const folders = pack.folders;
    const foldersEmpty =
      !folders || (typeof folders.size === "number" && folders.size === 0);
    if (foldersEmpty) {
      // Find one entry that has a folder ID and load it to trigger
      // the folder collection to be populated.
      for (const entry of pack.index?.values?.() ?? []) {
        if (entry?.folder && entry?.uuid) {
          await fromUuid(entry.uuid);
          break;
        }
      }
    }
  } catch (_) {
    // ignore - folder classification will gracefully handle missing folders
  }

  const entries = _normalizeIndexEntries(pack.index);
  return { entries, error: null };
}

function _matchTalentFolderKindFromName(name) {
  const lower = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!lower) return null;

  // Crew/Character talents - match "Crew", "Crew Talents", "Character", etc.
  if (/(^|\b)crew(\b|$)/i.test(lower)) return "crew";
  if (/(^|\b)character(\b|$)/i.test(lower)) return "crew";

  // Ship/Starship talents - match "Ship", "Ship Talents", "Starship", etc.
  // Check starship first to avoid partial match on "ship" within "starship"
  if (/(^|\b)star\s*ship(\b|$)/i.test(lower)) return "starship";
  if (/(^|\b)starship(\b|$)/i.test(lower)) return "starship";
  if (/(^|\b)ship(\b|$)/i.test(lower)) return "starship";

  return null;
}

function _classifyTalentFolder(pack, folderId) {
  const id = folderId ? String(folderId) : "";
  if (!pack || !id) return null;

  const folders = pack.folders;
  const getFolder = (fid) => {
    try {
      if (!folders) return null;
      if (typeof folders.get === "function") return folders.get(fid) ?? null;
      if (folders instanceof Map) return folders.get(fid) ?? null;
    } catch (_) {
      // ignore
    }
    return null;
  };

  let cur = id;
  for (let i = 0; i < 12 && cur; i++) {
    const f = getFolder(cur);
    if (!f) break;

    const kind = _matchTalentFolderKindFromName(f?.name);
    if (kind) return kind;

    const parent = f?.folder;
    cur = parent ? String(parent) : "";
  }

  return null;
}

function _packKeyFromUuid(uuid) {
  const raw = String(uuid ?? "");
  const prefix = "Compendium.";
  if (!raw.startsWith(prefix)) return "";
  const rest = raw.slice(prefix.length);
  const parts = rest.split(".");
  if (parts.length < 2) return "";
  // Remove item ID
  parts.pop();
  // Foundry v12+ UUIDs have format: module.packname.Item.itemId
  // After popping itemId, we may have "Item" (or other type) as last element - remove it too
  const lastPart = parts[parts.length - 1];
  if (
    lastPart &&
    /^(Item|Actor|JournalEntry|Scene|RollTable|Macro|Playlist)$/i.test(lastPart)
  ) {
    parts.pop();
  }
  return parts.join(".");
}

function _isConsolidatedTalentPackKey(packKey) {
  const key = String(packKey ?? "")
    .trim()
    .toLowerCase();
  return key.endsWith("items-1e") || key.endsWith("items-2e");
}

// Some compendiums (e.g. Forge shared packs) return index entries without a
// uuid; reconstruct it from the pack key + _id so downstream loads still work.
function _resolveEntryUuid(entry, packKey) {
  const existing = String(entry?.uuid ?? "").trim();
  if (existing) return existing;
  const id = String(entry?._id ?? "").trim();
  const key = String(packKey ?? "").trim();
  if (id && key) return `Compendium.${key}.Item.${id}`;
  return null;
}

function _classifyTalentFolderFromDocument(doc, pack = null) {
  let cur = doc?.folder ?? null;

  // Handle case where folder is an ID string instead of a Folder object.
  // This can happen with compendium documents before full folder population.
  if (typeof cur === "string" && pack?.folders?.get) {
    cur = pack.folders.get(cur) ?? null;
  }

  for (let i = 0; i < 12 && cur; i++) {
    const kind = _matchTalentFolderKindFromName(cur?.name);
    if (kind) return kind;

    let parent = cur?.folder ?? null;
    // Parent folder reference may also be an ID string
    if (typeof parent === "string" && pack?.folders?.get) {
      parent = pack.folders.get(parent) ?? null;
    }
    cur = parent;
  }
  return null;
}

const EXCLUDED_SHIP_TALENT_NAMES = new Set(
  [
    "aging relic",
    "deluxe galley",
    "dependable workhorse",
    "hope ship",
    "legendary",
    "prototype",
    "survivor of (x)",
  ].map((n) => n.toLowerCase()),
);

function _isExcludedShipTalentName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (EXCLUDED_SHIP_TALENT_NAMES.has(lower)) return true;
  return false;
}

async function _getTalentDocumentByUuid(uuid) {
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    return doc ?? null;
  } catch (err) {
    console.error(`${MODULE_ID} | failed to load talent document`, err);
    return null;
  }
}

function _extractTalentItemData(document) {
  if (!document || typeof document.toObject !== "function") return null;
  const data = document.toObject();
  if (!isPlainObject(data)) return null;
  delete data._id;
  return data;
}

function _extractTalentDescription(document) {
  if (!document) return null;

  const rawDescription =
    foundry.utils.getProperty(document, "system.description.value") ??
    foundry.utils.getProperty(document, "system.description") ??
    document?.system?.description ??
    "";
  if (!rawDescription) return null;
  if (typeof rawDescription === "string") return rawDescription;
  if (
    isPlainObject(rawDescription) &&
    typeof rawDescription.value === "string"
  ) {
    return rawDescription.value;
  }
  return null;
}

function _descriptionHtmlToText(rawDescription) {
  const html = String(rawDescription ?? "").trim();
  if (!html) return "";

  let normalized = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  try {
    const TextEditorImpl =
      globalThis.foundry?.applications?.ux?.TextEditor?.implementation ??
      globalThis.TextEditor ??
      null;
    if (TextEditorImpl && typeof TextEditorImpl.getTextContent === "function") {
      normalized = TextEditorImpl.getTextContent(normalized);
    } else {
      normalized = normalized.replace(/<[^>]*>/g, " ");
    }
  } catch (_) {
    normalized = normalized.replace(/<[^>]*>/g, " ");
  }

  return String(normalized)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function _confirmTalentChoice({ name = "", description = "" } = {}) {
  const unnamedTalentLabel =
    t("sta-officers-log.dialog.talentPicker.confirmUnnamed") ??
    "(Unnamed Talent)";
  const noDescriptionLabel =
    t("sta-officers-log.dialog.talentPicker.confirmNoDescription") ??
    "No description available for this talent.";
  const safeName = escapeHTML(name || unnamedTalentLabel);
  const safeDescription = escapeHTML(description || noDescriptionLabel).replace(
    /\n/g,
    "<br />",
  );

  const result = await foundry.applications.api.DialogV2.wait({
    classes: ["sta-officers-log"],
    window: {
      title:
        t("sta-officers-log.dialog.talentPicker.confirmTitle") ??
        "Confirm Talent Choice",
    },
    content: `<div class="sta-picker-confirm-dialog"><p><strong>${safeName}</strong></p><p>${safeDescription}</p></div>`,
    buttons: [
      {
        action: "confirm",
        label:
          t("sta-officers-log.dialog.talentPicker.confirmButton") ?? "Confirm",
        default: true,
        callback: () => true,
      },
      {
        action: "cancel",
        label:
          t("sta-officers-log.dialog.talentPicker.cancelButton") ?? "Cancel",
        callback: () => false,
      },
    ],
    rejectClose: false,
    modal: true,
  });

  return result === true || result === "confirm";
}

function _isNpcTalentFromDocument(document) {
  if (!document) return false;

  const values = [
    foundry.utils.getProperty(document, "system.type"),
    foundry.utils.getProperty(document, "system.talenttype.type"),
    foundry.utils.getProperty(document, "system.talenttype.typeenum"),
  ];

  return values.some((value) => normalizeRequirementString(value) === "npc");
}

function _isStarshipTalentFromDocument(document) {
  if (!document) return false;

  const values = [
    foundry.utils.getProperty(document, "system.type"),
    foundry.utils.getProperty(document, "system.talenttype.type"),
    foundry.utils.getProperty(document, "system.talenttype.typeenum"),
  ];

  return values.some((value) => {
    const normalized = normalizeRequirementString(value);
    return normalized === "starship" || normalized === "systems";
  });
}

function _isNpcActor(actor) {
  if (!actor) return false;

  const actorType = normalizeRequirementString(actor?.type);
  if (actorType === "npc") return true;

  const npcType = normalizeRequirementString(
    foundry.utils.getProperty(actor, "system.npcType"),
  );
  if (["minor", "notable", "incidental", "quick"].includes(npcType)) {
    return true;
  }

  return Boolean(foundry.utils.getProperty(actor, "system.npc"));
}

function _isStarshipActor(actor) {
  const actorType = normalizeRequirementString(actor?.type);
  return actorType === "starship" || actorType === "smallcraft";
}

function _isCharacterCreationOnlyTalentDescription(rawDescription) {
  const html = String(rawDescription ?? "");
  if (!html) return false;

  // Normalize some common HTML block/line separators into newlines first,
  // so we can interpret "same line" more reliably.
  let normalized = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  // Prefer Foundry's HTML->text routine when available.
  try {
    const TextEditorImpl =
      globalThis.foundry?.applications?.ux?.TextEditor?.implementation ??
      globalThis.TextEditor ??
      null;
    if (TextEditorImpl && typeof TextEditorImpl.getTextContent === "function") {
      normalized = TextEditorImpl.getTextContent(normalized);
    } else {
      normalized = normalized.replace(/<[^>]*>/g, " ");
    }
  } catch (_) {
    normalized = normalized.replace(/<[^>]*>/g, " ");
  }

  const lines = String(normalized)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      /requirement\s*:/i.test(line) &&
      /during character creation/i.test(line)
    ) {
      return true;
    }
  }
  return false;
}

async function _getTalentDescription(uuid) {
  const doc = await _getTalentDocumentByUuid(uuid);
  if (!doc) return null;

  return _extractTalentDescription(doc);
}

async function _collectTalentPickerEntries({
  packKey = "",
  basePackKeys = [],
  extraPackKeys = [],
  priorityEntries = [],
  extraPriorityEntries = [],
  folderKind = "", // "crew" | "starship" | "" (no filtering)
  actor = null,
} = {}) {
  const packs = [];
  const addPack = (key) => {
    const normalized = String(key ?? "").trim();
    if (!normalized) return;
    if (!packs.includes(normalized)) packs.push(normalized);
  };

  // Built-in STA packs (base/extra) can be excluded via world setting so the
  // configured custom compendiums become the sole source.
  if (getTalentPickerIncludeBuiltinEnabled()) {
    for (const key of basePackKeys ?? []) addPack(key);
    for (const key of extraPackKeys ?? []) addPack(key);
  }

  const explicit = String(packKey ?? "").trim();
  if (explicit) addPack(explicit);

  const customPackKeys = getTalentPickerCustomCompendiumKeys();
  for (const custom of customPackKeys) {
    if (custom) addPack(custom);
  }

  const errors = [];
  const allEntries = [];

  // Avoid warning spam in mixed STA versions: only warn for missing
  // explicit/custom packs (not the default candidates).
  const missingShouldWarn = new Set(
    [
      explicit || null,
      ...(Array.isArray(customPackKeys) ? customPackKeys : []),
    ].filter(Boolean),
  );

  const wantedKind = String(folderKind ?? "")
    .trim()
    .toLowerCase();
  const actorIsNpc = _isNpcActor(actor);
  const actorIsStarship = _isStarshipActor(actor);

  for (const key of packs) {
    const pack = game.packs?.get?.(key) ?? null;
    if (!pack) {
      if (missingShouldWarn.has(key)) {
        errors.push(`Missing compendium pack: ${key}`);
      }
      continue;
    }

    const { entries, error } = await _getTalentIndexEntries({ packKey: key });
    if (error) errors.push(error);
    if (entries?.length) {
      // Consolidated packs (items-1e/items-2e) still separate crew vs starship
      // by folder lineage; other packs rely on talent-type filtering downstream.
      const isConsolidated =
        key.endsWith("items-1e") || key.endsWith("items-2e");
      const shouldFilterByFolder = isConsolidated;
      if (!wantedKind || !shouldFilterByFolder) {
        allEntries.push({ key, entries });
      } else {
        const filtered = entries.filter((e) => {
          if (String(e?.type ?? "").toLowerCase() !== "talent") return false;
          const kind = _classifyTalentFolder(pack, e?.folder);
          // If we can't classify, keep it (safer than hiding content unexpectedly).
          if (!kind) return true;
          return kind === wantedKind;
        });
        allEntries.push({ key, entries: filtered });
      }
    }
  }

  const priorityMap = new Map();
  const applyPriority = (key, value) => {
    const normalized = String(key ?? "").trim();
    if (!normalized) return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const existing = priorityMap.get(normalized);
    if (existing === undefined || numeric > existing) {
      priorityMap.set(normalized, numeric);
    }
  };

  for (const entry of priorityEntries ?? []) {
    applyPriority(entry?.[0], entry?.[1]);
  }
  for (const entry of extraPriorityEntries ?? []) {
    applyPriority(entry?.[0], entry?.[1]);
  }
  for (const custom of customPackKeys) {
    if (custom) applyPriority(custom, 4);
  }
  if (explicit) applyPriority(explicit, 4);

  const getPriority = (key) => priorityMap.get(key) ?? 3;

  const byName = new Map();
  for (const batch of allEntries) {
    const priority = getPriority(batch.key);
    if (priority === 0) continue;
    for (const entry of batch.entries) {
      if (String(entry?.type ?? "").toLowerCase() !== "talent") continue;
      const name = String(entry?.name ?? "").trim();
      if (!name) continue;

      if (wantedKind === "starship" && _isExcludedShipTalentName(name)) {
        continue;
      }

      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing && existing.priority > priority) continue;

      byName.set(key, {
        priority,
        value: {
          name,
          img: entry?.img ?? null,
          uuid: _resolveEntryUuid(entry, batch.key),
          folder: entry?.folder ?? null,
        },
      });
    }
  }

  let talents = Array.from(byName.values()).map((item) => item.value);
  talents = await Promise.all(
    talents.map(async (talent) => {
      const packKey = _packKeyFromUuid(talent.uuid);
      const isConsolidated = _isConsolidatedTalentPackKey(packKey);
      const shouldFilterByFolder = isConsolidated;
      const doc = await _getTalentDocumentByUuid(talent.uuid);
      if (_isNpcTalentFromDocument(doc) && !actorIsNpc) {
        return null;
      }

      if (_isStarshipTalentFromDocument(doc) && !actorIsStarship) {
        return null;
      }

      const rawDescription = _extractTalentDescription(doc);
      if (
        wantedKind === "crew" &&
        _isCharacterCreationOnlyTalentDescription(rawDescription)
      ) {
        return null;
      }

      if (wantedKind && shouldFilterByFolder) {
        const pack = packKey ? (game.packs?.get?.(packKey) ?? null) : null;
        const kindFromDoc = _classifyTalentFolderFromDocument(doc, pack);
        let kind = kindFromDoc;
        if (!kind) {
          kind = _classifyTalentFolder(pack, talent.folder);
        }
        // Only filter out if we positively identified the wrong kind.
        // If classification failed (kind is null), keep the talent.
        if (kind && kind !== wantedKind) return null;
      }

      return {
        ...talent,
        talenttype: doc?.system?.talenttype ?? null,
        item: _extractTalentItemData(doc),
      };
    }),
  );

  talents = talents.filter(Boolean);

  return { talents, errors };
}

class TalentPickerApp extends Base {
  constructor(
    {
      talents = [],
      resolve = null,
      actor = null,
      pickerKind = "character",
    } = {},
    options = {},
  ) {
    super(options);
    this._talents = Array.isArray(talents) ? talents : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
    this._actor = actor ?? null;
    this._pickerKind = pickerKind;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-talent-picker`,
    window: { title: "Choose Talent" },
    classes: ["sta-officers-log", "focus-picker"],
    position: { width: 520, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/talent-picker.hbs`,
    },
  };

  _deriveCategoryFromImg(img, talentName) {
    return _deriveTalentCategoryFromImg(img, talentName);
  }

  async _prepareContext(_options) {
    return prepareTalentPickerContext(this._talents, this._actor, {
      pickerKind: this._pickerKind,
    });
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error(`${MODULE_ID} | TalentPickerApp resolve failed`, err);
    }
  }

  async close(options = {}) {
    this._resolveOnce(null);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    super._attachPartListeners?.(partId, htmlElement, _options);
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    const binding = bindTalentPickerInteractions(root, this._talents, {
      onChoose: async (entry) => {
        const name = String(entry?.name ?? "").trim();
        if (!name) return;

        let talentItem = entry?.item ?? null;
        let talentType = entry?.talenttype ?? null;
        const uuid = String(entry?.uuid ?? "").trim();
        if (uuid && !talentItem) {
          const selectedTalent = this._talents.find(
            (talent) => String(talent?.uuid ?? "") === uuid,
          );
          talentItem = talentItem ?? selectedTalent?.item ?? null;
          talentType = talentType ?? selectedTalent?.talenttype ?? null;
        }

        this._resolveOnce({
          name,
          img: entry?.img ? String(entry.img).trim() : null,
          uuid: uuid || null,
          item: talentItem,
          talenttype: talentType ?? null,
        });
        await super.close();
      },
      onCustom: async () => {
        this._resolveOnce({ custom: true });
        await super.close();
      },
      onCancel: async () => {
        this._resolveOnce(null);
        await super.close();
      },
    });

    binding.applyFilter();
  }
}

function _createTalentPickerLoadingDialog() {
  const title =
    t("sta-officers-log.dialog.talentPicker.loadingTitle") ?? "Loading Talents";
  const message =
    t("sta-officers-log.dialog.talentPicker.loadingMessage") ??
    "Loading talents from compendiums...";
  return new foundry.applications.api.DialogV2({
    window: { title },
    classes: ["sta-officers-log", "talent-loading-dialog"],
    content: `<div class="sta-talent-loading-dialog"><div class="sta-talent-loading-spinner" aria-hidden="true"></div><div class="sta-talent-loading-message">${message}</div></div>`,
    buttons: [
      {
        action: "loading",
        label: " ",
        callback: () => false,
      },
    ],
    default: "loading",
    closeOnSubmit: false,
    rejectClose: true,
    modal: true,
  });
}
async function _promptTalentPickerFromPackList(options = {}) {
  const loadingDialog = _createTalentPickerLoadingDialog();
  await loadingDialog.render(true);
  let loadResult;
  try {
    loadResult = await loadTalentPickerTalents(options);
  } finally {
    loadingDialog?.close();
  }

  const { talents, errors } = loadResult ?? { talents: [], errors: [] };

  for (const msg of errors ?? []) {
    ui.notifications?.warn?.(msg);
  }

  if (!talents.length) {
    ui.notifications?.warn?.("No talents found in the available compendiums.");
    return null;
  }

  const pickerKind = options.folderKind === "starship" ? "ship" : "character";

  // Prefer the browser-styled picker from sta-utils; fall back to the built-in
  // list picker when sta-utils is inactive or the delegation fails.
  try {
    const { runTalentBrowserPicker } = await import("./talentPickerBridge.js");
    const bridged = await runTalentBrowserPicker({
      actor: options.actor ?? null,
      pickerKind,
      talents,
      allowCustom: options.allowCustom !== false,
    });
    if (!bridged.fallback) {
      return bridged.chosen;
    }
  } catch (err) {
    console.error(
      `${MODULE_ID} | talent browser picker failed; using fallback`,
      err,
    );
  }

  return new Promise((resolve) => {
    const app = new TalentPickerApp({
      talents,
      resolve,
      actor: options.actor ?? null,
      pickerKind,
    });
    app.render(true);
  });
}

export async function promptTalentChoiceFromCompendium({
  actor = null,
  packKey = "",
  allowCustom = true,
} = {}) {
  return _promptTalentPickerFromPackList({
    actor,
    packKey,
    allowCustom,
    basePackKeys: TALENT_BASE_PACKS,
    extraPackKeys: [TALENT_CREW_PACK],
    priorityEntries: TALENT_BASE_PACKS.map((key, idx) => [key, idx + 1]),
    extraPriorityEntries: [[TALENT_CREW_PACK, 5]],
    folderKind: "crew",
  });
}

export async function promptShipTalentChoiceFromCompendium({
  actor = null,
  packKey = "",
  allowCustom = true,
} = {}) {
  return _promptTalentPickerFromPackList({
    actor,
    packKey,
    allowCustom,
    basePackKeys: SHIP_TALENT_BASE_PACKS,
    priorityEntries: SHIP_TALENT_BASE_PACKS.map((key, idx) => [key, idx + 1]),
    folderKind: "starship",
  });
}

/**************************************************
 *              TALENT REQUIREMENTS               *
 *************************************************/

// Retrieves a numeric property from an object, or null if not found/invalid.
// Used for grabbing attribute/discipline values from an actor.
// obj: should be an actor
// path: string path to the property (e.g., "system.attributes.strength.value")
const getNumeric = (obj, path) => {
  const v = foundry.utils.getProperty(obj, path);
  if (v === 0 || v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const ATTRIBUTE_NAME_TO_KEY = (() => {
  const map = new Map();
  for (const key of ATTRIBUTE_KEYS) {
    map.set(key.toLowerCase(), key);
    const label = ATTRIBUTE_LABELS[key];
    if (label) map.set(label.toLowerCase(), key);
  }
  return map;
})();

const DISCIPLINE_NAME_TO_KEY = (() => {
  const map = new Map();
  for (const key of DISCIPLINE_KEYS) {
    map.set(key.toLowerCase(), key);
    const label = DISCIPLINE_LABELS[key];
    if (label) map.set(label.toLowerCase(), key);
  }
  return map;
})();

const getTraitNames = (actor) => {
  const items = actor?.items ?? [];
  return items
    .filter((item) => String(item?.type ?? "").toLowerCase() === "trait")
    .map((trait) => normalizeRequirementString(trait?.name));
};

/**
 * Check whether an actor has a given species (case-insensitive).
 * Checks trait items first (most reliable for STA characters created via the
 * wizard), then the system.species field (STA 2e), then system.details.species
 * (legacy path).
 */
const _actorHasSpecies = (actor, speciesNorm) => {
  // A requirement value may list several qualifying species/traits separated by
  // commas (e.g. "vulcan, augment, cyborg"); the actor matches if it has ANY.
  const options = String(speciesNorm ?? "")
    .split(",")
    .map((s) => normalizeRequirementString(s))
    .filter(Boolean);
  if (!options.length) return true;

  const traits = getTraitNames(actor);
  const sysSpecies =
    normalizeRequirementString(
      foundry.utils.getProperty(actor, "system.species"),
    ) ||
    normalizeRequirementString(
      foundry.utils.getProperty(actor, "system.details.species"),
    );

  return options.some((opt) => {
    if (traits.some((name) => name === opt || name.includes(opt))) return true;
    return sysSpecies === opt || sysSpecies.includes(opt);
  });
};

/**
 * Try to infer the required species name from a talent entry when the talent
 * does not have typeenum set to "species". Returns a normalized species name
 * string, or null if the talent doesn't appear to be species-locked.
 *
 * Uses two signals:
 *   1. The talent name itself is a known species name (e.g. "Vulcan").
 *   2. The talent image path contains a species name (e.g. "talent-vulcan.svg").
 */
export const _inferRequiredSpeciesFromTalent = (talentEntry) => {
  const name = normalizeRequirementString(talentEntry?.name);
  if (name && SPECIES_TALENT_NAMES.has(name)) return name;
  const img = String(talentEntry?.img ?? "").toLowerCase();
  for (const species of SPECIES_TALENT_NAMES) {
    if (
      img.includes(`-${species}`) ||
      img.includes(`/${species}`) ||
      img.includes(`_${species}`)
    )
      return species;
  }
  return null;
};

const _getNpcSpeciesRequirement = (talentEntry) => {
  const fromItemFlag = normalizeRequirementString(
    foundry.utils.getProperty(
      talentEntry,
      `item.flags.${MODULE_ID}.npcRequirement.species`,
    ),
  );
  if (fromItemFlag) return fromItemFlag;

  const fromRootFlag = normalizeRequirementString(
    foundry.utils.getProperty(
      talentEntry,
      `flags.${MODULE_ID}.npcRequirement.species`,
    ),
  );
  if (fromRootFlag) return fromRootFlag;

  const fromDescription = normalizeRequirementString(
    talentEntry?.talenttype?.description,
  );
  return fromDescription || "";
};

const getLegacyHouse = (actor) => {
  const legacy = foundry.utils.getProperty(actor, "system.legacy");
  if (!legacy) return "";
  if (typeof legacy === "string") return normalizeRequirementString(legacy);
  const house = normalizeRequirementString(legacy?.house);
  if (house) return house;
  const label = normalizeRequirementString(legacy?.label);
  if (label) return label;
  return "";
};

const requirementTypeLabels = {
  attribute: "Attribute",
  discipline: "Department",
  species: "Species",
  house: "House",
  system: "System",
  systems: "Systems",
  condition: "Condition",
  general: "General",
  npc: "NPC",
  starship: "Starship",
};

const formatRequirementClauseLabel = (category, clause) => {
  const rawValue = String(clause?.value ?? "").trim();
  if (!rawValue) return "";

  if (category === "attribute") {
    const key = resolveAttributeKey(rawValue);
    const label =
      (key && ATTRIBUTE_LABELS[key]) ||
      humanizeRequirementValue(rawValue) ||
      rawValue;
    const min = Number.isFinite(Number(clause?.minimum))
      ? Number(clause.minimum)
      : null;
    return min != null ? `${label} ${min}+` : label;
  }

  if (category === "discipline") {
    const key = resolveDisciplineKey(rawValue);
    const label =
      (key && DISCIPLINE_LABELS[key]) ||
      humanizeRequirementValue(rawValue) ||
      rawValue;
    const min = Number.isFinite(Number(clause?.minimum))
      ? Number(clause.minimum)
      : null;
    return min != null ? `${label} ${min}+` : label;
  }

  if (category === "type") {
    const norm = normalizeRequirementString(rawValue);
    if (norm === "npc") return "NPC";
    if (norm === "character") return "Character";
    if (norm === "starship") return "Starship";
  }

  if (category === "systems") {
    const label = humanizeRequirementValue(rawValue) || rawValue;
    const min = Number.isFinite(Number(clause?.minimum))
      ? Number(clause.minimum)
      : null;
    return min != null ? `${label} ${min}+` : label;
  }

  return humanizeRequirementValue(rawValue) || rawValue;
};

const formatRequirementCategoryLabel = (entry) => {
  const category = normalizeRequirementString(entry?.category);
  if (!category) return "";

  const clauses = Array.isArray(entry?.clauses) ? entry.clauses : [];
  const clauseLabels = clauses
    .map((clause) => formatRequirementClauseLabel(category, clause))
    .filter(Boolean);

  if (!clauseLabels.length) return "";

  const categoryLabel =
    requirementTypeLabels[category] ?? humanizeRequirementValue(category);
  const operator =
    String(entry?.operator ?? "OR").toUpperCase() === "AND" ? "AND" : "OR";

  return `${categoryLabel}: ${clauseLabels.join(` ${operator} `)}`;
};

const evaluateRequirementCategory = (actor, entry, talentEntry) => {
  const category = normalizeRequirementString(entry?.category);
  const clauses = Array.isArray(entry?.clauses)
    ? entry.clauses.filter((clause) => String(clause?.value ?? "").trim())
    : [];
  if (!category || !clauses.length) return true;

  const opIsAnd = String(entry?.operator ?? "OR").toUpperCase() === "AND";
  const checks = clauses.map((clause) => {
    const rawValue = String(clause?.value ?? "").trim();
    const value = normalizeRequirementString(rawValue);

    switch (category) {
      case "attribute": {
        const key = resolveAttributeKey(value);
        if (!key) return false;
        const actorValue =
          getNumeric(actor, `system.attribute.${key}.value`) ??
          getNumeric(actor, `system.attributes.${key}.value`);
        if (actorValue == null) return false;
        const minimum = Number.isFinite(Number(clause?.minimum))
          ? Number(clause.minimum)
          : null;
        return minimum == null ? true : actorValue >= minimum;
      }
      case "discipline": {
        const key = resolveDisciplineKey(value);
        if (!key) return false;
        const actorValue = getNumeric(actor, `system.disciplines.${key}.value`);
        if (actorValue == null) return false;
        const minimum = Number.isFinite(Number(clause?.minimum))
          ? Number(clause.minimum)
          : null;
        return minimum == null ? true : actorValue >= minimum;
      }
      case "species":
        return _actorHasSpecies(actor, value);
      case "systems": {
        // Ship system rating — only a starship can satisfy it; characters/NPCs
        // can never meet a ship-system requirement.
        if (!_isStarshipActor(actor)) return false;
        const actorValue = getNumeric(actor, `system.systems.${value}.value`);
        if (actorValue == null) return false;
        const minimum = Number.isFinite(Number(clause?.minimum))
          ? Number(clause.minimum)
          : null;
        return minimum == null ? true : actorValue >= minimum;
      }
      case "condition":
        // Narrative condition — GM adjudicates; never auto-filter.
        return true;
      case "type": {
        if (value === "npc") return _isNpcActor(actor);
        if (value === "starship") return _isStarshipActor(actor);
        if (value === "character") {
          return !_isNpcActor(actor) && !_isStarshipActor(actor);
        }
        return false;
      }
      case "house": {
        const house = getLegacyHouse(actor);
        return house.includes(value);
      }
      default: {
        const inferred = _inferRequiredSpeciesFromTalent(talentEntry);
        if (inferred) return _actorHasSpecies(actor, inferred);
        return true;
      }
    }
  });

  return opIsAnd ? checks.every(Boolean) : checks.some(Boolean);
};

export const formatTalentRequirementLabel = (
  talenttype,
  talentEntry = null,
) => {
  const normalizedRequirements = getNormalizedTalentRequirements(talentEntry, {
    inferSpecies: _inferRequiredSpeciesFromTalent,
  });
  if (normalizedRequirements.length) {
    const labels = normalizedRequirements
      .map((entry) => formatRequirementCategoryLabel(entry))
      .filter(Boolean);
    if (labels.length) {
      return labels.join(" ; ");
    }
  }

  if (!talenttype) return "";
  const type = normalizeRequirementString(talenttype.typeenum);
  const description = String(talenttype.description ?? "").trim();
  const minimum = Number.isFinite(Number(talenttype.minimum))
    ? Number(talenttype.minimum)
    : null;

  if (!type) return "";
  const typeLabel =
    requirementTypeLabels[type] ?? humanizeRequirementValue(type);
  const minSuffix = minimum != null ? ` ≥ ${minimum}` : "";

  switch (type) {
    case "attribute": {
      const key = resolveAttributeKey(description);
      const label =
        (key && ATTRIBUTE_LABELS[key]) ||
        humanizeRequirementValue(description) ||
        humanizeRequirementValue(type);
      return `${typeLabel}: ${label}${minSuffix}`;
    }
    case "discipline": {
      const key = resolveDisciplineKey(description);
      const label =
        (key && DISCIPLINE_LABELS[key]) ||
        humanizeRequirementValue(description) ||
        humanizeRequirementValue(type);
      return `${typeLabel}: ${label}${minSuffix}`;
    }
    case "species": {
      const label = humanizeRequirementValue(description) || typeLabel;
      return `${typeLabel}: ${label}`;
    }
    case "house": {
      const label = humanizeRequirementValue(description) || typeLabel;
      return `${typeLabel}: ${label}`;
    }
    case "npc": {
      const requiredSpecies =
        _getNpcSpeciesRequirement(talentEntry) ||
        normalizeRequirementString(talenttype.description);
      if (!requiredSpecies) return typeLabel;
      return `${typeLabel}: ${humanizeRequirementValue(requiredSpecies)}`;
    }
    case "systems":
    case "starship":
      return typeLabel;
    default:
      return typeLabel;
  }
};

export function doesActorMeetTalentRequirements(actor, talentEntry) {
  if (!actor) return true;
  const normalizedRequirements = getNormalizedTalentRequirements(talentEntry, {
    inferSpecies: _inferRequiredSpeciesFromTalent,
  });
  if (normalizedRequirements.length) {
    return normalizedRequirements.every((entry) =>
      evaluateRequirementCategory(actor, entry, talentEntry),
    );
  }

  const talenttype =
    talentEntry?.talenttype ?? talentEntry?.system?.talenttype ?? null;
  if (!talenttype) {
    // Even without talenttype, infer species requirement from name/image.
    if (actor) {
      const inferred = _inferRequiredSpeciesFromTalent(talentEntry);
      if (inferred) return _actorHasSpecies(actor, inferred);
    }
    return true;
  }

  const type = normalizeRequirementString(talenttype.typeenum);
  const description = normalizeRequirementString(talenttype.description);
  const minimum = Number.isFinite(Number(talenttype.minimum))
    ? Number(talenttype.minimum)
    : null;

  switch (type) {
    case "spell":
    case "general":
      // If the talent is identifiable as a species talent by name or image,
      // treat it as a species requirement even when typeenum is not "species".
      if (actor) {
        const inferred = _inferRequiredSpeciesFromTalent(talentEntry);
        if (inferred) return _actorHasSpecies(actor, inferred);
      }
      return true;
    case "system":
      return true;
    case "discipline": {
      const key = resolveDisciplineKey(description);
      if (!key) return false;
      const value = getNumeric(actor, `system.disciplines.${key}.value`);
      if (value == null) return false;
      if (minimum == null) return true;
      return value >= minimum;
    }
    case "attribute": {
      const key = resolveAttributeKey(description);
      if (!key) return false;
      const value =
        getNumeric(actor, `system.attribute.${key}.value`) ??
        getNumeric(actor, `system.attributes.${key}.value`);
      if (value == null) return false;
      if (minimum == null) return true;
      return value >= minimum;
    }
    case "species": {
      // Use the description if set; otherwise infer species from name/image.
      const required =
        description || _inferRequiredSpeciesFromTalent(talentEntry);
      if (!required) return true;
      return _actorHasSpecies(actor, required);
    }
    case "house": {
      if (!description) return true;
      const house = getLegacyHouse(actor);
      return house.includes(description);
    }
    case "npc": {
      if (!_isNpcActor(actor)) return false;
      const requiredSpecies = _getNpcSpeciesRequirement(talentEntry);
      if (!requiredSpecies) return true;
      return _actorHasSpecies(actor, requiredSpecies);
    }
    case "starship":
    case "systems": {
      return _isStarshipActor(actor);
    }
    default:
      // Last-resort species inference for talents with unrecognised requirement types.
      if (actor) {
        const inferred = _inferRequiredSpeciesFromTalent(talentEntry);
        if (inferred) return _actorHasSpecies(actor, inferred);
      }
      return true;
  }
}
