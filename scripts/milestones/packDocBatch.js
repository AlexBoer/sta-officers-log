// Loads many compendium documents with one query per pack instead of one
// fromUuid() round trip per document. Returns Map<uuid, Document>.
export async function batchLoadPackDocuments(uuids = []) {
  const byPack = new Map();
  for (const uuid of uuids) {
    if (!uuid) continue;
    let parsed = null;
    try {
      parsed = foundry.utils.parseUuid(uuid);
    } catch (_) {
      continue;
    }
    const pack = parsed?.collection;
    if (!pack?.getDocuments || !parsed.id) continue;
    if (!byPack.has(pack)) byPack.set(pack, new Map());
    byPack.get(pack).set(parsed.id, uuid);
  }

  const result = new Map();
  await Promise.all(
    Array.from(byPack, async ([pack, idMap]) => {
      try {
        const docs = await pack.getDocuments({ _id__in: [...idMap.keys()] });
        for (const doc of docs) {
          const uuid = idMap.get(doc.id);
          if (uuid) result.set(uuid, doc);
        }
      } catch (err) {
        console.warn("sta-officers-log | batch pack load failed", err);
      }
    }),
  );
  return result;
}

// Index rows from the shared sta-utils index become lightweight stand-ins for
// full item data. They are marked so the chosen one can be hydrated later.
export function indexRowToItem(row) {
  return {
    name: row?.name ?? "",
    img: row?.img ?? null,
    type: row?.type ?? "",
    system: foundry.utils.deepClone(row?.system ?? {}),
    flags: foundry.utils.deepClone(row?.flags ?? {}),
    _indexOnly: true,
  };
}

// Replaces an index-only `item` on a picker result with the full item data.
export async function hydrateIndexedChoice(choice) {
  if (!choice?.item?._indexOnly) return choice;
  let data = null;
  try {
    const doc = choice.uuid ? await fromUuid(choice.uuid) : null;
    data = doc?.toObject?.() ?? null;
  } catch (err) {
    console.warn("sta-officers-log | failed to hydrate picker choice", err);
  }
  if (data) {
    delete data._id;
  } else {
    data = { ...choice.item };
    delete data._indexOnly;
  }
  return { ...choice, item: data };
}
