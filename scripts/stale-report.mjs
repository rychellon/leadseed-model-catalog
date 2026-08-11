import { entries, loadCatalog } from "./catalog-lib.mjs";

const now = new Date(process.env.CATALOG_NOW ?? Date.now());
const grouped = new Map();
for (const { modality, model, provider, spec } of entries(loadCatalog())) {
  if (!spec.price_last_verified) continue;
  const age = Math.floor((now - new Date(`${spec.price_last_verified}T00:00:00Z`)) / 86_400_000);
  if (age <= 45) continue;
  if (!grouped.has(provider)) grouped.set(provider, []);
  grouped.get(provider).push(`- ${modality}/${model}: verified ${spec.price_last_verified} (${age} days old)${spec.price_stale_ack ? ` — acknowledged: ${spec.price_stale_ack}` : ""}`);
}

console.log("# Catalog prices older than 45 days\n");
if (!grouped.size) {
  console.log("No stale prices.");
} else {
  for (const [provider, lines] of [...grouped].sort()) {
    console.log(`## ${provider}\n`);
    console.log(lines.join("\n"));
    console.log();
  }
}
