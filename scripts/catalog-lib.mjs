import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CATALOG_DIR = path.join(ROOT, "catalog");
export const MODALITY_FILES = [
  "image.json",
  "video_image_to_video.json",
  "upscale_image.json",
  "upscale_video.json",
];

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadCatalog(dir = CATALOG_DIR) {
  const catalog = {};
  for (const filename of [...MODALITY_FILES, "canonical_args.json"]) {
    const value = readJson(path.join(dir, filename));
    Object.assign(catalog, value);
  }
  return catalog;
}

export function entries(catalog) {
  const out = [];
  for (const [modality, section] of Object.entries(catalog)) {
    if (modality === "canonical_args") continue;
    for (const [model, spec] of Object.entries(section.models ?? {})) {
      for (const [provider, providerSpec] of Object.entries(spec.providers ?? {})) {
        out.push({ modality, model, provider, spec: providerSpec });
      }
    }
  }
  return out;
}

export function priceFields(spec) {
  const prices = [];
  for (const [key, value] of Object.entries(spec)) {
    if ((key.includes("price") || key.includes("pricing")) && typeof value === "number") {
      prices.push([key, value]);
    }
    if ((key.includes("price") || key.includes("pricing")) && value && typeof value === "object") {
      for (const [tier, tierValue] of Object.entries(value)) {
        if (typeof tierValue === "number") prices.push([`${key}.${tier}`, tierValue]);
      }
    }
  }
  return prices;
}

export function primaryPrice(spec) {
  for (const field of ["unit_price_usd", "unit_price_per_second_usd"]) {
    if (typeof spec[field] === "number") return { field, value: spec[field] };
  }
  return null;
}
