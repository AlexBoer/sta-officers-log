/**
 * Creation Wizard Data
 *
 * Data constants, species catalog loader, and actor creation function
 * for the Creation in Play wizard.
 *
 * @module creation/creationWizardData
 */

import { MODULE_ID } from "../core/constants.js";
import { getTalentPickerCustomCompendiumKeys } from "../settings/pickerSettings.js";

export const ATTRIBUTE_KEYS = [
  "control",
  "daring",
  "fitness",
  "insight",
  "presence",
  "reason",
];

export const DISCIPLINE_KEYS = [
  "command",
  "conn",
  "engineering",
  "security",
  "science",
  "medicine",
];

export const ATTRIBUTE_LABELS = {
  control: "Control",
  daring: "Daring",
  fitness: "Fitness",
  insight: "Insight",
  presence: "Presence",
  reason: "Reason",
};

export const DISCIPLINE_LABELS = {
  command: "Command",
  conn: "Conn",
  engineering: "Engineering",
  medicine: "Medicine",
  science: "Science",
  security: "Security",
};

/** Base attribute chip pool for PC creation: 10, 10, 9, 9, 8, 7 */
export const CREATION_ATTR_CHIPS = [10, 10, 9, 9, 8, 7];

/** Available remaining department ratings after two primary departments are chosen */
export const REMAINING_DEPT_RATINGS = [3, 2, 2, 1];

/** How many of each element a fully-created character needs */
export const CREATION_TARGETS = {
  values: 4, // 1 from wizard + 3 during play
  departments: 6, // 2 from wizard + 4 during play (all must be > 0 to finish)
  focuses: 6, // all defined during play
  talents: 4, // all defined during play
};

/** Standard 2e roles for the role dropdown */
export const STANDARD_ROLES = [
  "Commanding Officer",
  "First Officer",
  "Chief Medical Officer",
  "Chief Engineer",
  "Chief of Security",
  "Chief Science Officer",
  "Flight Controller",
  "Operations Officer",
  "Counselor",
  "Communications Officer",
  "Tactical Officer",
  "Doctor",
  "Nurse",
  "Science Officer",
  "Engineer",
  "Security Officer",
  "Diplomat",
  "Ambassador",
  "Intelligence Officer",
  "Merchant Captain",
  "Station Administrator",
  "Civilian",
];

/** Starfleet / organization divisions */
export const DIVISIONS = [
  { key: "command", label: "Command" },
  { key: "operations", label: "Operations" },
  { key: "sciences", label: "Sciences" },
  { key: "medical", label: "Medical" },
  { key: "civilian", label: "Civilian / Non-Starfleet" },
  { key: "other", label: "Other" },
];

// ── Equipment ─────────────────────────────────────────────────────────────────
// UUIDs can be filled in once you have the compendium entries.
// When uuid is null the item is created by name as a basic shell.

export const EQUIPMENT_ITEMS = {
  TRICORDER: { name: "Tricorder", uuid: null, type: "item" },
  COMMUNICATOR: { name: "Communicator", uuid: null, type: "item" },
  UNIFORM: { name: "Uniform", uuid: null, type: "item" },
  PHASER_TYPE1: {
    name: "Phaser Type-1",
    uuid: null,
    type: "characterweapon2e",
  },
  PHASER_TYPE2: {
    name: "Phaser Type-2",
    uuid: null,
    type: "characterweapon2e",
  },
  ENGINEERING_KIT: { name: "Engineering Kit", uuid: null, type: "item" },
  MED_KIT: { name: "Medical Kit", uuid: null, type: "item" },
};

/**
 * Fetch an item from the compendium by UUID, falling back to a basic shell.
 * @param {{ name: string, uuid: string|null, type: string }} entry
 * @returns {Promise<object>} Item data ready for createEmbeddedDocuments
 */
async function _fetchOrBuildItem(entry) {
  if (entry.uuid) {
    try {
      const doc = await fromUuid(entry.uuid);
      if (doc) {
        const data = doc.toObject();
        delete data._id;
        return data;
      }
    } catch (_) {}
  }
  return { type: entry.type, name: entry.name, system: {} };
}

// ── Species catalog ──────────────────────────────────────────────────────────

let _speciesCatalogCache = null;
let _roleBenefitsCache = null;

export async function loadRoleBenefits() {
  if (_roleBenefitsCache) return _roleBenefitsCache;
  try {
    const res = await fetch(
      `/modules/${MODULE_ID}/scripts/creation/role-benefits.json`,
    );
    const data = await res.json();
    _roleBenefitsCache = data.roles ?? [];
  } catch (e) {
    console.warn(
      `${MODULE_ID} | Creation Wizard: could not load role-benefits.json`,
      e,
    );
    _roleBenefitsCache = [];
  }
  return _roleBenefitsCache;
}

export async function loadSpeciesCatalog() {
  if (_speciesCatalogCache) return _speciesCatalogCache;
  try {
    const res = await fetch(
      `/modules/${MODULE_ID}/scripts/creation/species-catalog.json`,
    );
    const data = await res.json();
    _speciesCatalogCache = data.species ?? [];
  } catch (e) {
    console.warn(
      `${MODULE_ID} | Creation Wizard: could not load species-catalog.json`,
      e,
    );
    _speciesCatalogCache = [];
  }
  return _speciesCatalogCache;
}

// ── Species talent name lookup ───────────────────────────────────────────────

/**
 * Search all configured talent compendiums for a talent whose name matches
 * `abilityName` (case-insensitive). Returns the first matching UUID or null.
 *
 * Uses the same compendium keys as the talent picker (set in module settings).
 *
 * @param {string} abilityName
 * @returns {Promise<string|null>}
 */
async function _findSpeciesTalentInCompendiums(abilityName) {
  if (!abilityName?.trim()) return null;
  const normalizedName = abilityName.trim().toLowerCase();
  const packKeys = getTalentPickerCustomCompendiumKeys();
  for (const packKey of packKeys) {
    const pack = game.packs.get(packKey);
    if (!pack) continue;
    try {
      const index = await pack.getIndex();
      const entry = index.find(
        (e) => e.type === "talent" && e.name.toLowerCase() === normalizedName,
      );
      if (entry) return entry.uuid;
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Could not search pack "${packKey}" for species talent`,
        err,
      );
    }
  }
  return null;
}

// ── Actor creation ────────────────────────────────────────────────────────────

/**
 * Create a new 2e character actor in "Creation in Play" mode.
 *
 * @param {object} state  The completed wizard state.
 * @returns {Promise<Actor>} The created actor.
 */
export async function createCreationInPlayActor(state) {
  const {
    name,
    species,
    role,
    division,
    careerTrait,
    equipmentNotes,
    attributes,
    departments,
    primaryDept1,
    primaryDept2,
    value,
    selectedAttributeBonuses,
    phaserChoice,
    includeEngineeringKit,
    includeMedKit,
  } = state;

  // Resolve species catalog entry for bonuses
  const catalog = await loadSpeciesCatalog();
  const _speciesKey = (species ?? "").trim().toLowerCase();
  const speciesEntry = catalog.find(
    (s) =>
      s.name.toLowerCase() === _speciesKey ||
      (s.aliases ?? []).some((a) => a.toLowerCase() === _speciesKey),
  );

  // Build attribute values (base + species bonus)
  const attributeUpdate = {};
  for (const key of ATTRIBUTE_KEYS) {
    const base = attributes[key] ?? 7;
    // When the species has fixed per-attribute bonuses, use them.
    // When attributeBonuses is null (Human, Borg, custom species, etc.) the
    // player chose 3 attributes in the wizard; apply +1 to each of those.
    let bonus = 0;
    if (
      speciesEntry &&
      speciesEntry.attributeBonuses !== null &&
      speciesEntry.attributeBonuses !== undefined
    ) {
      bonus = speciesEntry.attributeBonuses[key] ?? 0;
    } else {
      bonus = (selectedAttributeBonuses ?? []).includes(key) ? 1 : 0;
    }
    attributeUpdate[key] = { value: base + bonus };
  }

  // Build discipline values
  const disciplineUpdate = {};
  for (const key of DISCIPLINE_KEYS) {
    disciplineUpdate[key] = { value: departments[key] ?? 0 };
  }

  // Build stress (Fitness attribute value, calculated with bonus)
  const fitnessValue = attributeUpdate.fitness?.value ?? 9;

  // Create actor data
  const actorData = {
    name: name || "New Character",
    type: "character",
    system: {
      species: species || "",
      characterrole: role || "",
      attributes: attributeUpdate,
      disciplines: disciplineUpdate,
      stress: { value: 0, max: fitnessValue },
      determination: { value: 1, max: 3 },
      reputation: 10,
    },
    flags: {
      core: {
        sheetClass: "sta.STACharacterSheet2e",
      },
    },
  };

  const actor = await Actor.create(actorData);
  if (!actor) throw new Error(`${MODULE_ID} | Failed to create actor`);

  // Build embedded items
  const embeddedItems = [];

  // Career trait
  if (careerTrait?.trim()) {
    embeddedItems.push({
      type: "trait",
      name: careerTrait.trim(),
      system: { description: "" },
    });
  }

  // Species trait (just the species name as a trait)
  if (species?.trim()) {
    embeddedItems.push({
      type: "trait",
      name: species.trim(),
      system: { description: "" },
    });
  }

  // Starting value
  if (value?.trim()) {
    embeddedItems.push({
      type: "value",
      name: value.trim(),
      system: { description: "" },
    });
  }

  if (embeddedItems.length) {
    await actor.createEmbeddedDocuments("Item", embeddedItems);
  }

  // ── Equipment ──────────────────────────────────────────────────────────────
  // Auto-assigned: Tricorder, Communicator, Uniform — always created.
  // Optional: phaser choice and kits.
  const equipmentEntries = [
    EQUIPMENT_ITEMS.TRICORDER,
    EQUIPMENT_ITEMS.COMMUNICATOR,
    EQUIPMENT_ITEMS.UNIFORM,
  ];
  if (phaserChoice === "type1")
    equipmentEntries.push(EQUIPMENT_ITEMS.PHASER_TYPE1);
  else if (phaserChoice === "type2")
    equipmentEntries.push(EQUIPMENT_ITEMS.PHASER_TYPE2);
  if (includeEngineeringKit)
    equipmentEntries.push(EQUIPMENT_ITEMS.ENGINEERING_KIT);
  if (includeMedKit) equipmentEntries.push(EQUIPMENT_ITEMS.MED_KIT);

  const equipmentItemData = await Promise.all(
    equipmentEntries.map(_fetchOrBuildItem),
  );
  if (equipmentItemData.length) {
    await actor.createEmbeddedDocuments("Item", equipmentItemData);
  }

  // ── Species talent ─────────────────────────────────────────────────────────
  // Lookup order:
  //   1. Explicit talentUuid in the catalog (always wins)
  //   2. abilityName search across configured talent compendiums
  //   3. Nothing — player adds it manually during play
  const bonusTalentIds = [];
  const speciesTalentUuid =
    speciesEntry?.talentUuid ??
    (speciesEntry?.abilityName
      ? await _findSpeciesTalentInCompendiums(speciesEntry.abilityName)
      : null);
  if (speciesTalentUuid) {
    try {
      const doc = await fromUuid(speciesTalentUuid);
      if (doc) {
        const talentData = doc.toObject();
        delete talentData._id;
        const [created] = await actor.createEmbeddedDocuments("Item", [
          talentData,
        ]);
        if (created?.id) bonusTalentIds.push(created.id);
      }
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Could not load species talent ${speciesTalentUuid}`,
        err,
      );
    }
  }

  // ── Role benefit talent ────────────────────────────────────────────────────
  // Some roles grant a talent that does not count against the talent limit.
  const roleBenefits = await loadRoleBenefits();
  const roleBenefitEntry = roleBenefits.find(
    (r) => r.name.toLowerCase() === (role ?? "").trim().toLowerCase(),
  );
  if (roleBenefitEntry?.talentUuid) {
    try {
      const doc = await fromUuid(roleBenefitEntry.talentUuid);
      if (doc) {
        const talentData = doc.toObject();
        delete talentData._id;
        const [created] = await actor.createEmbeddedDocuments("Item", [
          talentData,
        ]);
        if (created?.id) bonusTalentIds.push(created.id);
      }
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Could not load role benefit talent ${roleBenefitEntry.talentUuid}`,
        err,
      );
    }
  }

  // Set the Creation in Play flag
  const definedDepts = [primaryDept1, primaryDept2].filter(Boolean);
  await actor.setFlag(MODULE_ID, "creationInPlay", {
    active: true,
    remainingDeptRatings: [...REMAINING_DEPT_RATINGS],
    equipmentNotes: equipmentNotes?.trim() ?? "",
    division: division ?? "",
    primaryDepartments: definedDepts,
    bonusTalentIds,
  });

  // Equipment notes go into the actor's notes field
  if (equipmentNotes?.trim()) {
    await actor.update({
      "system.notes": `**Equipment:** ${equipmentNotes.trim()}`,
    });
  }

  // Render the actor sheet
  actor.sheet?.render(true);

  return actor;
}
