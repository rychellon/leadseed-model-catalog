import path from "node:path";
import { fileURLToPath } from "node:url";
import { entries, loadCatalog, primaryPrice } from "./catalog-lib.mjs";

function entryMap(catalog) {
  return new Map(entries(catalog).map((entry) => [`${entry.modality}/${entry.model}/${entry.provider}`, entry]));
}

export function diffCatalogs(before, after) {
  const oldMap = entryMap(before);
  const newMap = entryMap(after);
  const changes = {
    disappeared: [],
    priceIncreases: [],
    supportsShrank: [],
    other: [],
  };

  for (const [key, oldEntry] of oldMap) {
    const next = newMap.get(key);
    if (!next) {
      changes.disappeared.push(`${key}: provider/model entry disappeared`);
      continue;
    }
    const oldPrice = primaryPrice(oldEntry.spec);
    const newPrice = primaryPrice(next.spec);
    if (oldPrice && newPrice && oldPrice.field === newPrice.field && oldPrice.value !== newPrice.value) {
      const pct = ((newPrice.value - oldPrice.value) / oldPrice.value) * 100;
      const message = `${key}: $${oldPrice.value} → $${newPrice.value} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
      (pct > 0 ? changes.priceIncreases : changes.other).push(message);
    } else if (!oldPrice && newPrice) {
      changes.other.push(`${key}: price unknown → $${newPrice.value}`);
    } else if (oldPrice && !newPrice) {
      changes.other.push(`${key}: $${oldPrice.value} → unknown`);
    }

    const oldSupports = new Set(oldEntry.spec.supports ?? []);
    const newSupports = new Set(next.spec.supports ?? []);
    const removed = [...oldSupports].filter((item) => !newSupports.has(item));
    const added = [...newSupports].filter((item) => !oldSupports.has(item));
    if (removed.length) changes.supportsShrank.push(`${key}: supports removed ${removed.join(", ")}`);
    if (added.length) changes.other.push(`${key}: supports added ${added.join(", ")}`);
    if (oldEntry.spec.id !== next.spec.id) changes.other.push(`${key}: id ${oldEntry.spec.id} → ${next.spec.id}`);
  }

  for (const key of newMap.keys()) {
    if (!oldMap.has(key)) changes.other.push(`${key}: provider/model entry added`);
  }
  return changes;
}

export function markdown(changes) {
  const groups = [
    ["Models or provider entries that disappeared", changes.disappeared],
    ["Price increases", changes.priceIncreases],
    ["Supported arguments that shrank", changes.supportsShrank],
    ["Everything else", changes.other],
  ];
  return groups.map(([title, items]) => `## ${title}\n\n${items.length ? items.map((item) => `- ${item}`).join("\n") : "- None"}`).join("\n\n");
}

export function title(changes) {
  const all = [...changes.priceIncreases, ...changes.other];
  const prices = all.filter((line) => line.includes("$")) .length;
  const modelKey = (line) => line.split(":", 1)[0].split("/").slice(0, 2).join("/");
  const added = new Set(changes.other.filter((line) => line.endsWith("entry added")).map(modelKey)).size;
  const gone = new Set(changes.disappeared.map(modelKey)).size;
  return `catalog: ${prices} prices changed, ${added} models added, ${gone} models gone`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [beforeDir, afterDir] = process.argv.slice(2);
  if (!beforeDir || !afterDir) {
    console.error("Usage: node scripts/catalog-diff.mjs <before-catalog-dir> <after-catalog-dir>");
    process.exit(2);
  }
  const changes = diffCatalogs(loadCatalog(path.resolve(beforeDir)), loadCatalog(path.resolve(afterDir)));
  console.log(title(changes));
  console.log(markdown(changes));
}
