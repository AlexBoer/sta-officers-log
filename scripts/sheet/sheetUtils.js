export function rerenderOpenStaSheetsForActorId(actorId) {
  const renderNoFocus = (app) => {
    // v13+ ApplicationV2 signature: render({ force, focus })
    app?.render?.({ force: true, focus: false });
  };

  const maybe = (app) => {
    try {
      if (
        !app?.id?.startsWith?.("STACharacterSheet2e") &&
        !app?.id?.startsWith?.("MobileCharacterSheet2e") &&
        !app?.id?.startsWith?.("LcarsCharacterSheet2e")
      )
        return;
      if (!actorId || app?.actor?.id !== actorId) return;
      renderNoFocus(app);
    } catch (_) {
      // sheet may have closed mid-iteration
    }
  };

  try {
    for (const w of Object.values(ui?.windows ?? {})) maybe(w);
  } catch (_) {
    // ui.windows may not exist
  }

  try {
    const instances = foundry?.applications?.instances;
    if (instances) {
      for (const app of instances.values()) maybe(app);
    }
  } catch (_) {
    // v13 instances API may not exist
  }
}

export function getItemFromApp(app) {
  return app?.item ?? null;
}

export function getActorFromAppOrItem(app, item) {
  return app?.actor ?? item?.parent ?? null;
}

/**
 * Ensure an inline actions container exists before the toggle element.
 */
export function ensureInlineActionsContainer(rowEl, toggleEl) {
  if (!(rowEl instanceof HTMLElement) || !(toggleEl instanceof HTMLElement)) {
    return null;
  }
  let container = rowEl.querySelector(".sta-log-inline-actions");
  if (!(container instanceof HTMLElement)) {
    container = document.createElement("span");
    container.className = "sta-log-inline-actions";
  }
  if (container.parentElement !== rowEl || container.nextSibling !== toggleEl) {
    rowEl.insertBefore(container, toggleEl);
  }
  return container;
}
