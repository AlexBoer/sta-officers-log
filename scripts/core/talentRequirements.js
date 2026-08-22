import { MODULE_ID } from "./constants.js";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_KEYS,
  DISCIPLINE_LABELS,
} from "./gameConstants.js";

export const TALENT_REQUIREMENTS_FLAG_KEY = "requirements";

const LEGACY_SECOND_REQ_FLAG_KEY = "secondReq";
const LEGACY_NPC_REQ_FLAG_KEY = "npcRequirement";

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

export const normalizeRequirementString = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const sanitizeRequirementOperator = (value) =>
  String(value ?? "OR").toUpperCase() === "AND" ? "AND" : "OR";

export const isNumericRequirementCategory = (category) =>
  normalizeRequirementString(category) === "attribute" ||
  normalizeRequirementString(category) === "discipline" ||
  normalizeRequirementString(category) === "systems";

export const resolveAttributeKey = (value) => {
  if (!value) return null;
  return ATTRIBUTE_NAME_TO_KEY.get(normalizeRequirementString(value)) ?? null;
};

export const resolveDisciplineKey = (value) => {
  if (!value) return null;
  return DISCIPLINE_NAME_TO_KEY.get(normalizeRequirementString(value)) ?? null;
};

export const humanizeRequirementValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

function sanitizeRequirementClause(clause, category) {
  const value = String(clause?.value ?? "").trim();
  if (!value) return null;

  const result = { value };
  if (isNumericRequirementCategory(category)) {
    const n = Number(clause?.minimum);
    result.minimum = Number.isFinite(n) ? n : 0;
  }
  return result;
}

function sanitizeRequirementEntry(entry) {
  const category = normalizeRequirementString(entry?.category);
  if (!category) return null;

  const rawClauses = Array.isArray(entry?.clauses) ? entry.clauses : [];
  const clauses = rawClauses
    .map((clause) => sanitizeRequirementClause(clause, category))
    .filter(Boolean)
    .slice(0, 2);

  if (!clauses.length) return null;

  return {
    category,
    operator: sanitizeRequirementOperator(entry?.operator),
    clauses,
  };
}

export function getStoredTalentRequirements(talentEntry) {
  const fromItem = foundry.utils.getProperty(
    talentEntry,
    `item.flags.${MODULE_ID}.${TALENT_REQUIREMENTS_FLAG_KEY}`,
  );
  const fromRoot = foundry.utils.getProperty(
    talentEntry,
    `flags.${MODULE_ID}.${TALENT_REQUIREMENTS_FLAG_KEY}`,
  );
  const raw = Array.isArray(fromItem) ? fromItem : fromRoot;
  if (!Array.isArray(raw) || !raw.length) return [];

  return raw.map(sanitizeRequirementEntry).filter(Boolean);
}

function getLegacySecondReq(talentEntry) {
  const fromItem = foundry.utils.getProperty(
    talentEntry,
    `item.flags.${MODULE_ID}.${LEGACY_SECOND_REQ_FLAG_KEY}`,
  );
  const fromRoot = foundry.utils.getProperty(
    talentEntry,
    `flags.${MODULE_ID}.${LEGACY_SECOND_REQ_FLAG_KEY}`,
  );
  const raw = fromItem ?? fromRoot ?? null;
  return {
    description: String(raw?.description ?? "").trim(),
    minimum: Number.isFinite(Number(raw?.minimum)) ? Number(raw.minimum) : 0,
  };
}

export function getLegacyNpcSpeciesRequirement(talentEntry) {
  const fromItem = String(
    foundry.utils.getProperty(
      talentEntry,
      `item.flags.${MODULE_ID}.${LEGACY_NPC_REQ_FLAG_KEY}.species`,
    ) ?? "",
  ).trim();
  if (fromItem) return fromItem;

  return String(
    foundry.utils.getProperty(
      talentEntry,
      `flags.${MODULE_ID}.${LEGACY_NPC_REQ_FLAG_KEY}.species`,
    ) ?? "",
  ).trim();
}

function buildLegacyRequirements(talentEntry, options = {}) {
  const talenttype =
    talentEntry?.talenttype ?? talentEntry?.system?.talenttype ?? null;
  if (!talenttype) return [];

  const inferSpecies =
    typeof options.inferSpecies === "function" ? options.inferSpecies : null;

  const type = normalizeRequirementString(talenttype.typeenum);
  const description = String(talenttype.description ?? "").trim();
  const minimum = Number.isFinite(Number(talenttype.minimum))
    ? Number(talenttype.minimum)
    : 0;

  if (type === "attribute" || type === "discipline") {
    const clauses = [];
    if (description) {
      clauses.push({ value: description, minimum });
    }
    const secondReq = getLegacySecondReq(talentEntry);
    if (secondReq.description) {
      clauses.push({
        value: secondReq.description,
        minimum: Number.isFinite(Number(secondReq.minimum))
          ? Number(secondReq.minimum)
          : 0,
      });
    }
    if (!clauses.length) return [];
    return [
      {
        category: type,
        operator: "OR",
        clauses: clauses.slice(0, 2),
      },
    ];
  }

  if (type === "species") {
    const inferred = description || inferSpecies?.(talentEntry) || "";
    if (!inferred) return [];
    return [
      {
        category: "species",
        operator: "OR",
        clauses: [{ value: inferred }],
      },
    ];
  }

  if (type === "npc") {
    const species = getLegacyNpcSpeciesRequirement(talentEntry) || description;
    const requirements = [
      {
        category: "type",
        operator: "OR",
        clauses: [{ value: "npc" }],
      },
    ];
    if (species) {
      requirements.push({
        category: "species",
        operator: "OR",
        clauses: [{ value: species }],
      });
    }
    return requirements;
  }

  if ((type === "general" || type === "spell") && inferSpecies) {
    const inferred = inferSpecies(talentEntry);
    if (inferred) {
      return [
        {
          category: "species",
          operator: "OR",
          clauses: [{ value: inferred }],
        },
      ];
    }
  }

  if (type === "house" && description) {
    return [
      {
        category: "house",
        operator: "OR",
        clauses: [{ value: description }],
      },
    ];
  }

  return [];
}

export function getNormalizedTalentRequirements(talentEntry, options = {}) {
  const stored = getStoredTalentRequirements(talentEntry);
  if (stored.length) return stored;
  return buildLegacyRequirements(talentEntry, options)
    .map(sanitizeRequirementEntry)
    .filter(Boolean);
}

export function deriveLegacyRequirementUpdate(requirements) {
  const normalized = Array.isArray(requirements)
    ? requirements.map(sanitizeRequirementEntry).filter(Boolean)
    : [];

  const firstByCategory = (category) =>
    normalized.find((entry) => entry.category === category) ?? null;

  const typeEntry = firstByCategory("type");
  const attrEntry = firstByCategory("attribute");
  const discEntry = firstByCategory("discipline");
  const speciesEntry = firstByCategory("species");

  const legacy = {
    typeenum: "general",
    description: "",
    minimum: 0,
    secondReq: { description: "", minimum: 0 },
    npcSpecies: "",
  };

  const isNpcType = Boolean(
    typeEntry?.clauses?.some(
      (clause) => normalizeRequirementString(clause?.value) === "npc",
    ),
  );

  if (isNpcType) {
    legacy.typeenum = "npc";
    legacy.description = "";
    legacy.minimum = 0;
    const species = String(speciesEntry?.clauses?.[0]?.value ?? "").trim();
    legacy.npcSpecies = species;
    legacy.description = species;
    return legacy;
  }

  const numericEntry = attrEntry ?? discEntry;
  if (numericEntry) {
    legacy.typeenum = numericEntry.category;
    legacy.description = String(numericEntry.clauses?.[0]?.value ?? "").trim();
    legacy.minimum = Number.isFinite(Number(numericEntry.clauses?.[0]?.minimum))
      ? Number(numericEntry.clauses?.[0]?.minimum)
      : 0;

    if (
      numericEntry.clauses.length > 1 &&
      sanitizeRequirementOperator(numericEntry.operator) === "OR"
    ) {
      legacy.secondReq = {
        description: String(numericEntry.clauses[1]?.value ?? "").trim(),
        minimum: Number.isFinite(Number(numericEntry.clauses[1]?.minimum))
          ? Number(numericEntry.clauses[1]?.minimum)
          : 0,
      };
    }

    return legacy;
  }

  if (speciesEntry?.clauses?.length) {
    legacy.typeenum = "species";
    legacy.description = String(speciesEntry.clauses[0]?.value ?? "").trim();
    legacy.minimum = 0;
    return legacy;
  }

  return legacy;
}
