import { MODULE_ID } from "./constants.js";

export async function setValueChallenged(valueItem, challenged) {
  if (!valueItem) return;
  const sys = valueItem.system ?? {};

  if (Object.prototype.hasOwnProperty.call(sys, "challenged")) {
    await valueItem.update({ "system.challenged": Boolean(challenged) });
    return;
  }

  // Some STA sheets appear to implement this as a strike-through toggle.
  if (Object.prototype.hasOwnProperty.call(sys, "used")) {
    await valueItem.update({ "system.used": Boolean(challenged) });
    return;
  }

  // Fallback: store a module flag so the state isn't lost.
  await valueItem.setFlag(MODULE_ID, "challenged", Boolean(challenged));
}

export function isValueChallenged(valueItem) {
  if (!valueItem) return false;

  const sys = valueItem.system ?? {};
  if (Boolean(sys.challenged)) return true;

  // Some STA sheets represent “challenged” via the strike-through toggle.
  if (Boolean(sys.used)) return true;

  // Fallback flag used by this module.
  try {
    return Boolean(valueItem.getFlag?.(MODULE_ID, "challenged"));
  } catch (_err) {
    return false;
  }
}
