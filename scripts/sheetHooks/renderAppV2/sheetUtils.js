import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
} from "./logSorting.js";

/**
 * Returns true if this actor reference is from an unlinked token.
 * Changes made to unlinked token actors do not persist to the world actor.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isUnlinkedTokenActor(actor) {
  try {
    if (!actor) return false;
    // actor.isToken is true when the actor is a synthetic token actor
    // actor.token?.actorLink being false means it's not linked to the world actor
    if (actor.isToken === true) {
      const tokenDoc = actor.token ?? null;
      if (tokenDoc && tokenDoc.actorLink === false) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Checks if any player-assigned characters have unlinked prototype tokens.
 * Returns an array of { userId, userName, actorId, actorName } for misconfigured actors.
 * @returns {Array<{userId: string, userName: string, actorId: string, actorName: string}>}
 */
export function getPlayerCharactersWithUnlinkedPrototypeTokens() {
  const results = [];
  try {
    const users = Array.from(game.users ?? []);
    for (const u of users) {
      if (u.isGM) continue;
      const char = u.character;
      if (!char || char.type !== "character") continue;
      // Check prototype token (the default token settings for this actor)
      const prototypeToken = char.prototypeToken ?? null;
      if (prototypeToken && prototypeToken.actorLink === false) {
        results.push({
          userId: u.id,
          userName: u.name ?? u.id,
          actorId: char.id,
          actorName: char.name ?? char.id,
        });
      }
    }
  } catch (_) {
    // ignore
  }
  return results;
}

export function getUserIdForCharacterActor(actor) {
  if (!actor) return null;
  // Prefer the (non-GM) user whose assigned character is this actor.
  const users = Array.from(game.users ?? []);
  const assignedNonGM = users.find(
    (u) => !u.isGM && u.character && u.character.id === actor.id,
  );
  if (assignedNonGM) return assignedNonGM.id;
  const assignedAny = users.find(
    (u) => u.character && u.character.id === actor.id,
  );
  return assignedAny?.id ?? null;
}

export function canCurrentUserChangeActor(actor) {
  try {
    if (!actor) return false;
    if (typeof actor.isOwner === "boolean") return actor.isOwner;
    return !!actor.testUserPermission?.(
      game.user,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    );
  } catch (_) {
    return false;
  }
}

export function rerenderOpenStaSheetsForActorId(actorId) {
  const renderNoFocus = (app) => {
    // Foundry has multiple render signatures across generations:
    // - ApplicationV2: render({ force, focus })
    // - Legacy: render(force, options)
    // We try the object form first to ensure focus is not stolen.
    try {
      if (typeof app?.render === "function") {
        app.render({ force: true, focus: false });
        return;
      }
    } catch (_) {
      // ignore
    }

    try {
      app.render?.(true, { focus: false });
      return;
    } catch (_) {
      // ignore
    }

    try {
      app.render?.(true);
    } catch (_) {
      // ignore
    }
  };

  const maybe = (app) => {
    try {
      if (!app?.id?.startsWith?.("STACharacterSheet2e")) return;
      if (!actorId || app?.actor?.id !== actorId) return;
      renderNoFocus(app);
    } catch (_) {
      // ignore
    }
  };

  try {
    for (const w of Object.values(ui?.windows ?? {})) maybe(w);
  } catch (_) {
    // ignore
  }

  try {
    const instances = foundry?.applications?.instances;
    if (instances) {
      if (typeof instances.values === "function") {
        for (const app of instances.values()) maybe(app);
      } else {
        for (const app of Object.values(instances)) maybe(app);
      }
    }
  } catch (_) {
    // ignore
  }
}

function _getApplicationRootElement(app) {
  try {
    const el = app?.element ?? app?._element ?? null;
    if (!el) return null;
    if (el instanceof HTMLElement) return el;
    // Some Foundry builds expose a jQuery-like wrapper.
    if (Array.isArray(el) && el[0] instanceof HTMLElement) return el[0];
    if (typeof el.get === "function") {
      const got = el.get(0);
      return got instanceof HTMLElement ? got : null;
    }
    if (el?.[0] instanceof HTMLElement) return el[0];
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Re-applies mission-log sorting to any already-open STA character sheets for this actor.
 * This updates the DOM in-place (no render) to avoid stealing focus or causing window flash.
 */
export function refreshMissionLogSortingForActorId(actorId) {
  const maybe = (app) => {
    try {
      if (!app?.id?.startsWith?.("STACharacterSheet2e")) return;
      if (!actorId || app?.actor?.id !== actorId) return;
      const root = _getApplicationRootElement(app);
      if (!root) return;

      const actor = app.actor;
      const mode = getMissionLogSortModeForActor(actor);
      applyMissionLogSorting(root, actor, mode);
    } catch (_) {
      // ignore
    }
  };

  try {
    for (const w of Object.values(ui?.windows ?? {})) maybe(w);
  } catch (_) {
    // ignore
  }

  try {
    const instances = foundry?.applications?.instances;
    if (instances) {
      if (typeof instances.values === "function") {
        for (const app of instances.values()) maybe(app);
      } else {
        for (const app of Object.values(instances)) maybe(app);
      }
    }
  } catch (_) {
    // ignore
  }
}

/**
 * Checks if an actor is a Supporting Character based on its sheet class.
 * Supporting characters use the STA Supporting Sheet, not the main Character Sheet.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isSupportingCharacter(actor) {
  if (!actor) return false;
  try {
    const sheetClass =
      actor.getFlag?.("core", "sheetClass") ??
      foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
      "";
    return String(sheetClass) === "sta.STASupportingSheet2e";
  } catch (_) {
    return false;
  }
}

export function getItemFromApp(app) {
  return app?.item ?? null;
}

export function getActorFromAppOrItem(app, item) {
  return app?.actor ?? item?.parent ?? null;
}

export function openCreatedItemSheetAfterMilestone(actor, createdItemId) {
  const id = createdItemId ? String(createdItemId) : "";
  if (!id || !actor?.items?.get) return;

  // Defer one tick so the character sheet rerender can finish first.
  setTimeout(() => {
    try {
      const item = actor.items.get(id);
      const sheet = item?.sheet;
      if (!sheet) return;
      sheet.render?.(true);
      if (typeof sheet.bringToFront === "function") sheet.bringToFront();
      else if (typeof sheet.bringToTop === "function") sheet.bringToTop();
    } catch (_) {
      // ignore
    }
  }, 0);
}
