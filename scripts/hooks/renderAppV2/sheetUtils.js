import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
} from "./logSorting.js";

/**
 * Returns true if this actor reference is from an unlinked token.
 * Changes made to unlinked token actors do not persist to the world actor, which can cause problems with callbacks and mission logs.
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
    // v13+ ApplicationV2 signature: render({ force, focus })
    app?.render?.({ force: true, focus: false });
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
      for (const app of instances.values()) maybe(app);
    }
  } catch (_) {
    // ignore
  }
}

/** Returns the root HTMLElement for an ApplicationV2 instance. */
function _getApplicationRootElement(app) {
  return app?.element instanceof HTMLElement ? app.element : null;
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
      for (const app of instances.values()) maybe(app);
    }
  } catch (_) {
    // ignore
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
      sheet.bringToFront?.();
    } catch (_) {
      // ignore
    }
  }, 0);
}
