/**
 * Macro: Import Talent Second Requirements from Descriptions
 *
 * Scans a selected compendium for talent items whose description begins with a
 * line of the form:
 *   REQUIREMENT: Science 3+ or Medicine 3+
 *
 * When a dual requirement is found and the talent's primary requirement already
 * matches one side, the other side is written into the
 * flags['sta-officers-log'].secondReq flag.
 *
 * GM-only. Self-contained — no module imports required.
 */

(async () => {
  const MODULE_ID = "sta-officers-log";
  const FLAG_KEY = "secondReq";

  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can run this macro.");
    return;
  }

  // ── Value ↔ display-name maps ─────────────────────────────────────────────

  const DISCIPLINE_MAP = {
    command: ["command"],
    conn: ["conn"],
    engineering: ["engineering"],
    medicine: ["medicine"],
    science: ["science"],
    security: ["security"],
  };

  const ATTRIBUTE_MAP = {
    control: ["control"],
    daring: ["daring"],
    fitness: ["fitness"],
    insight: ["insight"],
    presence: ["presence"],
    reason: ["reason"],
  };

  const SYSTEMS_MAP = {
    communications: ["communications", "comms"],
    computers: ["computers"],
    engines: ["engines"],
    sensors: ["sensors"],
    structure: ["structure"],
    weapons: ["weapons"],
  };

  // Build a flat lookup: lowercase display name → { typeenum, value }
  function buildLookup(map, typeenum) {
    const out = {};
    for (const [value, aliases] of Object.entries(map)) {
      for (const alias of aliases) {
        out[alias.toLowerCase()] = { typeenum, value };
      }
      // Also use localized name if available
      try {
        const locKey =
          typeenum === "discipline"
            ? `sta.actor.character.discipline.${value}`
            : typeenum === "attribute"
              ? `sta.actor.character.attribute.${value}`
              : `sta.actor.starship.system.${value}`;
        const localized = game.i18n.localize(locKey)?.toLowerCase();
        if (localized && localized !== locKey.toLowerCase()) {
          out[localized] = { typeenum, value };
        }
      } catch (_) {
        /* ignore */
      }
    }
    return out;
  }

  const LOOKUP = {
    ...buildLookup(DISCIPLINE_MAP, "discipline"),
    ...buildLookup(ATTRIBUTE_MAP, "attribute"),
    ...buildLookup(SYSTEMS_MAP, "systems"),
  };

  // ── Parse a requirement token like "Science 3+" → { value, minimum } ─────

  function parseReqToken(token) {
    // Match "Word 3+" or "Two Words 3+"
    const m = token.trim().match(/^(.+?)\s+(\d+)\s*\+?\s*$/i);
    if (!m) return null;
    const name = m[1].trim().toLowerCase();
    const minimum = parseInt(m[2], 10);
    const entry = LOOKUP[name];
    if (!entry) return null;
    return { ...entry, minimum };
  }

  // ── Extract first line of description (strip HTML) ────────────────────────

  function firstLineOfDescription(html) {
    if (!html) return "";
    // Strip tags, collapse whitespace, split on newlines / <br> / <p> boundaries
    const withBreaks = html
      .replace(/<\/p>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n");
    const plain = withBreaks.replace(/<[^>]+>/g, "").trim();
    return plain.split("\n")[0].trim();
  }

  // ── Parse dual requirement from first line ────────────────────────────────
  // Expects something like: "REQUIREMENT: Science 3+ or Medicine 3+"
  // Returns [reqA, reqB] or null.

  function parseDualRequirement(firstLine) {
    // Remove leading "REQUIREMENT:" label (case-insensitive, optional)
    const body = firstLine.replace(/^requirement\s*:\s*/i, "").trim();
    // Split on " or " (case-insensitive)
    const parts = body.split(/\s+or\s+/i);
    if (parts.length !== 2) return null;
    const a = parseReqToken(parts[0]);
    const b = parseReqToken(parts[1]);
    if (!a || !b) return null;
    return [a, b];
  }

  // ── Pick the compendium ───────────────────────────────────────────────────

  const itemPacks = game.packs.filter((p) => p.documentName === "Item");
  if (!itemPacks.length) {
    ui.notifications.warn("No item compendiums found.");
    return;
  }

  const packOptions = itemPacks
    .map(
      (p) =>
        `<option value="${p.collection}">${p.title} (${p.collection})</option>`,
    )
    .join("");

  const dialogResult = await new Promise((resolve) => {
    new Dialog({
      title: "Import Talent Second Requirements",
      content: `
        <p>Select a compendium to scan for dual-requirement talents.</p>
        <div style="margin-bottom:8px">
          <select id="pack-select" style="width:100%">${packOptions}</select>
        </div>
        <p style="font-size:0.85em;color:#888">
          Looks for lines like <em>REQUIREMENT: Science 3+ or Medicine 3+</em>
          and sets the second requirement flag on matching talents.
        </p>`,
      buttons: {
        run: {
          icon: '<i class="fas fa-play"></i>',
          label: "Scan & Update",
          callback: (html) => resolve(html.find("#pack-select").val()),
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: "run",
    }).render(true);
  });

  if (!dialogResult) return;

  const pack = game.packs.get(dialogResult);
  if (!pack) {
    ui.notifications.error(`Compendium "${dialogResult}" not found.`);
    return;
  }

  // ── Scan talents ──────────────────────────────────────────────────────────

  await pack.getIndex();
  const talentIndex = pack.index.filter((e) => e.type === "talent");

  if (!talentIndex.length) {
    ui.notifications.warn(`No talent items found in "${pack.title}".`);
    return;
  }

  let scanned = 0,
    updated = 0,
    skipped = 0;
  const log = [];

  for (const entry of talentIndex) {
    scanned++;
    const item = await pack.getDocument(entry._id);
    if (!item) continue;

    const typeenum = item.system?.talenttype?.typeenum;
    const primaryDesc = item.system?.talenttype?.description;
    const primaryMin = item.system?.talenttype?.minimum ?? 0;

    // Only relevant types
    if (!["discipline", "attribute", "systems"].includes(typeenum)) continue;

    const firstLine = firstLineOfDescription(item.system?.description ?? "");
    const dual = parseDualRequirement(firstLine);
    if (!dual) continue;

    const [reqA, reqB] = dual;

    // Both sides must be the same type as the primary
    if (reqA.typeenum !== typeenum || reqB.typeenum !== typeenum) {
      log.push(`⚠ ${item.name}: type mismatch in requirement line, skipped.`);
      skipped++;
      continue;
    }

    // Determine which side matches the primary and which is the second
    let second = null;
    if (reqA.value === primaryDesc) {
      second = reqB;
    } else if (reqB.value === primaryDesc) {
      second = reqA;
    } else {
      // Neither side matches primary — report but skip
      log.push(
        `⚠ ${item.name}: primary (${primaryDesc}) not found in "${firstLine}", skipped.`,
      );
      skipped++;
      continue;
    }

    // Check if already set correctly
    const existing = item.getFlag?.(MODULE_ID, FLAG_KEY);
    if (
      existing?.description === second.value &&
      existing?.minimum === second.minimum
    ) {
      log.push(
        `✓ ${item.name}: already set (${second.value} ${second.minimum}+), no change.`,
      );
      continue;
    }

    // Write the flag
    try {
      await item.setFlag(MODULE_ID, FLAG_KEY, {
        description: second.value,
        minimum: second.minimum,
      });
      log.push(
        `✔ ${item.name}: set secondReq → ${second.value} ${second.minimum}+`,
      );
      updated++;
    } catch (err) {
      log.push(`✘ ${item.name}: failed to set flag — ${err.message}`);
      skipped++;
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────

  const summary = `Scanned ${scanned} talent(s): ${updated} updated, ${skipped} skipped.`;
  console.log(`[${MODULE_ID}] Import Talent Second Requirements | ${summary}`);
  log.forEach((l) => console.log(`  ${l}`));

  await new Promise((resolve) => {
    new Dialog({
      title: "Import Complete",
      content: `
        <p><strong>${summary}</strong></p>
        <div style="max-height:300px;overflow-y:auto;font-size:0.85em;font-family:monospace;background:#111;color:#ccc;padding:8px;border-radius:4px">
          ${log.map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("") || "<div>No dual-requirement talents found.</div>"}
        </div>`,
      buttons: {
        ok: { label: "Close", callback: resolve },
      },
      default: "ok",
    }).render(true);
  });
})();
