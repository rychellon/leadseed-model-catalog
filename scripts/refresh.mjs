import fs from "node:fs";
import path from "node:path";
import { CATALOG_DIR, MODALITY_FILES, ROOT, loadCatalog, readJson, writeJson } from "./catalog-lib.mjs";
import { diffCatalogs, markdown, title } from "./catalog-diff.mjs";

const RAW_DIR = path.join(ROOT, "raw");
const OUT_DIR = path.join(ROOT, ".refresh");
const today = new Date().toISOString().slice(0, 10);

async function fetchText(url, headers = {}, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { headers });
    if (response.ok) return response.text();
    if (attempt === attempts || (response.status !== 429 && response.status < 500)) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) ? retryAfter * 1_000 : 500 * (2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`${url}: exhausted retries`);
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
  const pricingUrl = new URL("https://api.fal.ai/v1/models/pricing");
  for (const id of ids) pricingUrl.searchParams.append("endpoint_id", id);
  const pricingText = await fetchText(pricingUrl, { Authorization: `Key ${key}` });
  fs.writeFileSync(path.join(RAW_DIR, "fal-pricing.json"), pricingText);
  const pricingPayload = JSON.parse(pricingText);
  const prices = new Map();
  for (const row of pricingPayload.prices ?? []) {
    if (ids.has(row.endpoint_id) && typeof row.unit_price === "number") {
      prices.set(row.endpoint_id, row.unit_price);
    }
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
