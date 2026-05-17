/**
 * Macro: Reactivate Last Mission
 *
 * Restores the mission state that was cleared when "End Mission" was run.
 * Looks at log items on all character actors, groups them by name, finds the
 * most recently created group (the last completed mission), then lets the GM
 * confirm the title/participants before restoring:
 *
 *  - game.settings  missionTitle, missionParticipants, missionStartDate
 *  - system.currentMissionLogId on each participant's actor
 *
 * GM-only. Self-contained — no module imports required.
 * Can be pasted directly into the browser console or used as a Foundry macro.
 */

(async () => {
  const MODULE_ID = "sta-officers-log";

  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can reactivate a mission.");
    return;
  }

  // ── Collect all character actors ──────────────────────────────────────────
  const characterActors = game.actors.filter((a) => a.type === "character");
  if (!characterActors.length) {
    ui.notifications.warn("No character actors found.");
    return;
  }

  // ── Find log items per actor, group by name ───────────────────────────────
  // Structure: Map<logName, Array<{ actor, log, createdTime }>>
  const byName = new Map();

  for (const actor of characterActors) {
    for (const item of actor.items) {
      if (item.type !== "log") continue;
      const name = (item.name ?? "").trim();
      if (!name) continue;
      const createdTime = item._stats?.createdTime ?? 0;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ actor, log: item, createdTime });
    }
  }

  if (!byName.size) {
    ui.notifications.warn(
      "No mission log items found on any character actors.",
    );
    return;
  }

  // ── Find the most recently created mission group ──────────────────────────
  let bestName = null;
  let bestTime = -Infinity;

  for (const [name, entries] of byName) {
    const maxTime = Math.max(...entries.map((e) => e.createdTime));
    if (maxTime > bestTime) {
      bestTime = maxTime;
      bestName = name;
    }
  }

  // ── Sorted list of all known mission names (newest first) ─────────────────
  const sortedNames = [...byName.entries()]
    .sort(([, a], [, b]) => {
      const aMax = Math.max(...a.map((e) => e.createdTime));
      const bMax = Math.max(...b.map((e) => e.createdTime));
      return bMax - aMax;
    })
    .map(([name]) => name);

  const nameOptions = sortedNames
    .map(
      (n) =>
        `<option value="${n}"${n === bestName ? " selected" : ""}>${n}</option>`,
    )
    .join("");

  // ── Build actor→log rows for a given mission name ─────────────────────────
  function buildRows(missionName) {
    const entries = byName.get(missionName) ?? [];
    // Per actor: keep the most recently created log with this name
    const actorMap = new Map();
    for (const { actor, log, createdTime } of entries) {
      const existing = actorMap.get(actor.id);
      if (!existing || createdTime > existing.createdTime) {
        actorMap.set(actor.id, { actor, log, createdTime });
      }
    }
    return [...actorMap.values()];
  }

  // ── Dialog ────────────────────────────────────────────────────────────────
  async function showDialog(selectedName) {
    const rows = buildRows(selectedName);

    const actorRowsHtml = rows
      .map(({ actor, log }) => {
        const userId =
          game.users.find((u) => !u.isGM && u.character?.id === actor.id)?.id ??
          "";
        const created = log._stats?.createdTime
          ? new Date(log._stats.createdTime).toLocaleDateString()
          : "unknown";
        return `<tr>
        <td style="padding:2px 6px;">${actor.name}</td>
        <td style="padding:2px 6px;opacity:0.6;font-size:0.9em;">${created}</td>
        <td style="padding:2px 6px;opacity:0.6;font-size:0.85em;font-family:monospace;">${log.id}</td>
        <td style="padding:2px 6px;text-align:center;">
          <input type="checkbox" value="${actor.id}" data-log-id="${log.id}" data-user-id="${userId}" checked>
        </td>
      </tr>`;
      })
      .join("");

    const content = `
      <form id="ra-form">
        <div class="form-group">
          <label><strong>Mission to reactivate</strong></label>
          <select id="ra-mission-select" style="width:100%;">${nameOptions}</select>
        </div>
        <p style="margin:4px 0 6px;font-size:0.85em;opacity:0.65;">
          Select a different mission to refresh the actor list. Uncheck any actors to
          exclude them from participants.
        </p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="font-size:0.8em;opacity:0.6;">
            <th style="text-align:left;padding:2px 6px;">Actor</th>
            <th style="text-align:left;padding:2px 6px;">Log created</th>
            <th style="text-align:left;padding:2px 6px;">Log ID</th>
            <th style="padding:2px 6px;">Include</th>
          </tr></thead>
          <tbody id="ra-rows">${actorRowsHtml}</tbody>
        </table>
        <div class="form-group" style="margin-top:8px;">
          <label>Override mission title (optional)</label>
          <input type="text" id="ra-title" value="${selectedName}" style="width:100%;">
        </div>
        <div class="form-group">
          <label>Mission start date, YYYY-MM-DD (optional)</label>
          <input type="text" id="ra-date" placeholder="e.g. 2371-05-10" style="width:100%;">
        </div>
      </form>`;

    return new Promise((resolve) => {
      new Dialog({
        title: "Reactivate Last Mission",
        content,
        buttons: {
          reactivate: {
            icon: '<i class="fas fa-undo"></i>',
            label: "Reactivate",
            callback: (html) => {
              const form = html[0]?.querySelector("#ra-form");
              if (!form) {
                resolve(null);
                return;
              }

              const title =
                (form.querySelector("#ra-title")?.value ?? "").trim() ||
                selectedName;
              const startDate = (
                form.querySelector("#ra-date")?.value ?? ""
              ).trim();

              const participants = [];
              for (const cb of form.querySelectorAll(
                'input[type="checkbox"]:checked',
              )) {
                participants.push({
                  actorId: cb.value,
                  logId: cb.dataset.logId,
                  userId: cb.dataset.userId,
                });
              }
              resolve({ title, startDate, participants });
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel",
            callback: () => resolve(null),
          },
        },
        default: "cancel",
        render: (html) => {
          const sel = html[0]?.querySelector("#ra-mission-select");
          sel?.addEventListener("change", (ev) => {
            const newName = ev.target.value;
            // Close this dialog and reopen for the new selection
            Object.values(ui.windows ?? {})
              .find((w) => w?.options?.title === "Reactivate Last Mission")
              ?.close?.();
            setTimeout(() => showDialog(newName).then(resolve), 60);
          });
        },
      }).render(true);
    });
  }

  const result = await showDialog(bestName);
  if (!result) return;

  const { title, startDate, participants } = result;

  if (!participants.length) {
    ui.notifications.warn("No participants selected — nothing to reactivate.");
    return;
  }

  // ── Apply changes ─────────────────────────────────────────────────────────

  // 1. Restore world settings
  await game.settings.set(MODULE_ID, "missionTitle", title);
  await game.settings.set(
    MODULE_ID,
    "missionParticipants",
    participants.map((p) => p.userId).filter(Boolean),
  );
  if (startDate) {
    await game.settings.set(MODULE_ID, "missionStartDate", startDate);
  }

  // 2. Restore currentMissionLogId on each actor
  const ops = participants.map(({ actorId, logId }) => {
    const actor = game.actors.get(actorId);
    if (!actor) return Promise.resolve();
    return actor
      .update({ "system.currentMissionLogId": logId })
      .catch((err) =>
        console.warn(
          `${MODULE_ID} | reactivateMission: failed on ${actor.name}:`,
          err,
        ),
      );
  });
  await Promise.allSettled(ops);

  // 3. Nudge the STA Tracker to re-render
  try {
    game.STATracker?.render?.(true);
  } catch (_) {}

  ui.notifications.info(
    `Mission "${title}" reactivated with ${participants.length} participant(s).`,
  );
})();
