import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  CATALOG_DIR,
  MODALITY_FILES,
  ROOT,
  entries,
  priceFields,
  readJson,
} from "./catalog-lib.mjs";

const EXPECTED_WRAPPERS = {
  "image.json": "image",
  "video_image_to_video.json": "video_image_to_video",
  "upscale_image.json": "upscale_image",
  "upscale_video.json": "upscale_video",
  "canonical_args.json": "canonical_args",
};

export function validateCatalog({ root = ROOT, now = new Date(process.env.CATALOG_NOW ?? Date.now()) } = {}) {
  const errors = [];
  const catalogDir = path.join(root, "catalog");
  const schema = readJson(path.join(root, "schema/catalog.schema.json"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const catalog = {};

  for (const [filename, expectedWrapper] of Object.entries(EXPECTED_WRAPPERS)) {
    const file = path.join(catalogDir, filename);
    if (!fs.existsSync(file)) {
      errors.push(`${filename}: missing`);
      continue;
    }
    let value;
    try {
      value = readJson(file);
    } catch (error) {
      errors.push(`${filename}: invalid JSON (${error.message})`);
      continue;
    }
    if (!validate(value)) {
      for (const issue of validate.errors ?? []) {
        errors.push(`${filename}${issue.instancePath || "/"}: ${issue.message}`);
      }
    }
    if (Object.keys(value)[0] !== expectedWrapper) {
      errors.push(`${filename}: expected top-level key '${expectedWrapper}'`);
    }
    Object.assign(catalog, value);
  }

  const seen = new Map();
  for (const filename of MODALITY_FILES) {
    const wrapper = EXPECTED_WRAPPERS[filename];
    const section = catalog[wrapper];
    if (!section) continue;
    if (!Object.hasOwn(section.models ?? {}, section.default)) {
      errors.push(`${filename}: default '${section.default}' is not present in models`);
    }
    for (const model of Object.keys(section.models ?? {})) {
      if (seen.has(model)) {
        errors.push(`duplicate model key '${model}' in ${seen.get(model)} and ${filename}`);
      } else {
        seen.set(model, filename);
      }
    }
  }

  for (const { modality, model, provider, spec } of entries(catalog)) {
    const label = `${modality}.${model}.providers.${provider}`;
    if (!spec.id?.trim()) errors.push(`${label}: provider id is required`);
    const prices = priceFields(spec);
    if (prices.length && !spec.price_last_verified) {
      errors.push(`${label}: non-null price requires price_last_verified`);
    }
    if (spec.price_last_verified) {
      const verified = new Date(`${spec.price_last_verified}T00:00:00Z`);
      const ageDays = Math.floor((now - verified) / 86_400_000);
      if (!Number.isFinite(verified.valueOf())) {
        errors.push(`${label}: invalid price_last_verified '${spec.price_last_verified}'`);
      } else if (ageDays > 45 && !spec.price_stale_ack?.trim()) {
        errors.push(`${label}: price is ${ageDays} days old; re-verify or add price_stale_ack`);
      }
    }
  }

  const metaFile = path.join(root, "meta.json");
  if (!fs.existsSync(metaFile)) {
    errors.push("meta.json: missing");
  } else {
    const meta = readJson(metaFile);
    if (!/^\d+\.\d+\.\d+$/.test(meta.version ?? "")) errors.push("meta.json: version must be semantic x.y.z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.last_updated ?? "")) errors.push("meta.json: last_updated must be YYYY-MM-DD");
    if (!/^\d+\.\d+\.\d+$/.test(meta.schema_version ?? "")) errors.push("meta.json: schema_version must be semantic x.y.z");
    for (const [provider, providerMeta] of Object.entries(meta.providers ?? {})) {
      if (typeof providerMeta.credit_to_usd === "number" && !providerMeta.rate_last_verified) {
        errors.push(`meta.json: providers.${provider}.credit_to_usd requires rate_last_verified`);
      }
    }
  }

  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateCatalog();
  if (errors.length) {
    console.error(`Catalog validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("Catalog validation passed.");
}
