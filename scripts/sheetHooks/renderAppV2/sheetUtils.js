export function getUserIdForCharacterActor(actor) {
  if (!actor) return null;
  // Prefer the (non-GM) user whose assigned character is this actor.
  const users = Array.from(game.users ?? []);
  const assignedNonGM = users.find(
    (u) => !u.isGM && u.character && u.character.id === actor.id
  );
  if (assignedNonGM) return assignedNonGM.id;
  const assignedAny = users.find(
    (u) => u.character && u.character.id === actor.id
  );
  return assignedAny?.id ?? null;
}

export function canCurrentUserChangeActor(actor) {
  try {
    if (!actor) return false;
    if (typeof actor.isOwner === "boolean") return actor.isOwner;
    return !!actor.testUserPermission?.(
      game.user,
      CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
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
      sheet.bringToTop?.();
    } catch (_) {
      // ignore
    }
  }, 0);
}
