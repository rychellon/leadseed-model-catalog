import fs from "node:fs";
import path from "node:path";
import { CATALOG_DIR, MODALITY_FILES, ROOT, loadCatalog, readJson, writeJson } from "./catalog-lib.mjs";
import { diffCatalogs, markdown, title } from "./catalog-diff.mjs";

const RAW_DIR = path.join(ROOT, "raw");
const OUT_DIR = path.join(ROOT, ".refresh");
const today = new Date().toISOString().slice(0, 10);

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchFal() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is required");
  let cursor = null;
  let pageNumber = 1;
  const listingDir = path.join(RAW_DIR, "fal-models");
  fs.rmSync(listingDir, { recursive: true, force: true });
  fs.mkdirSync(listingDir, { recursive: true });
  do {
    const url = new URL("https://api.fal.ai/v1/models");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const text = await fetchText(url, { Authorization: `Key ${key}` });
    const page = JSON.parse(text);
    fs.writeFileSync(path.join(listingDir, `page-${String(pageNumber).padStart(3, "0")}.json`), text);
    pageNumber += 1;
    cursor = page.next_cursor;
  } while (cursor);

  const catalog = loadCatalog();
  const ids = new Set();
  for (const section of Object.values(catalog)) {
    for (const model of Object.values(section.models ?? {})) {
      if (model.providers?.fal?.id) ids.add(model.providers.fal.id);
    }
  }
  const pricingDir = path.join(RAW_DIR, "fal-pricing");
  fs.mkdirSync(pricingDir, { recursive: true });
  const prices = new Map();
  for (const id of ids) {
    const url = new URL("https://api.fal.ai/v1/models/pricing");
    url.searchParams.set("endpoint_id", id);
    const text = await fetchText(url, { Authorization: `Key ${key}` });
    fs.writeFileSync(path.join(pricingDir, `${encodeURIComponent(id)}.json`), text);
    const payload = JSON.parse(text);
    const row = payload.prices?.find((item) => item.endpoint_id === id) ?? payload.prices?.[0];
    if (typeof row?.unit_price === "number") prices.set(id, row.unit_price);
  }
  return prices;
}

async function fetchMuapi() {
  const key = process.env.MUAPI_KEY;
  if (!key) throw new Error("MUAPI_KEY is required");
  const url = process.env.MUAPI_MODELS_URL ?? "https://api.muapi.ai/api/v1/models";
  const text = await fetchText(url, { "x-api-key": key });
  fs.writeFileSync(path.join(RAW_DIR, "muapi-models.json"), text);
}

async function fetchKie() {
  const market = await fetchText("https://kie.ai/market");
  const pricing = await fetchText("https://kie.ai/pricing");
  fs.writeFileSync(path.join(RAW_DIR, "kie-market.html"), market);
  fs.writeFileSync(path.join(RAW_DIR, "kie-pricing.html"), pricing);
}

function snapshotCatalog() {
  const copy = {};
  for (const file of MODALITY_FILES) Object.assign(copy, readJson(path.join(CATALOG_DIR, file)));
  copy.canonical_args = readJson(path.join(CATALOG_DIR, "canonical_args.json")).canonical_args;
  return copy;
}

function applyFalPrices(prices) {
  for (const filename of MODALITY_FILES) {
    const file = path.join(CATALOG_DIR, filename);
    const value = readJson(file);
    const section = Object.values(value)[0];
    for (const model of Object.values(section.models)) {
      const provider = model.providers?.fal;
      const price = provider && prices.get(provider.id);
      if (typeof price !== "number") continue;
      const field = Object.hasOwn(provider, "unit_price_per_second_usd")
        ? "unit_price_per_second_usd"
        : Object.hasOwn(provider, "unit_price_usd") ? "unit_price_usd" : null;
      if (!field) continue;
      provider[field] = price;
      provider.price_last_verified = today;
      delete provider.price_stale_ack;
    }
    writeJson(file, value);
  }
}

fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const before = snapshotCatalog();
const falPrices = await fetchFal();
await fetchMuapi();
await fetchKie();
applyFalPrices(falPrices);
const after = snapshotCatalog();
const changes = diffCatalogs(before, after);
fs.writeFileSync(path.join(OUT_DIR, "title.txt"), `${title(changes)}\n`);
fs.writeFileSync(path.join(OUT_DIR, "body.md"), `${markdown(changes)}\n\nRaw provider responses were refreshed in \`raw/\`. Catalog changes require human review and this PR will never auto-merge.\n`);
console.log(title(changes));
