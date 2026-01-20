import { MODULE_ID } from "../../constants.js";

const TRAIT_SCAR_FLAG = "isScar";

export function isTraitScar(item) {
  if (!item || item.type !== "trait") return false;
  try {
    return Boolean(item.getFlag?.(MODULE_ID, TRAIT_SCAR_FLAG));
  } catch (_) {
    return false;
  }
}

export async function setTraitScarFlag(item, value) {
  if (!item || item.type !== "trait") return;
  await item.setFlag(MODULE_ID, TRAIT_SCAR_FLAG, Boolean(value));
}
