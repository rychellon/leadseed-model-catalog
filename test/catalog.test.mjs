import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ROOT, loadCatalog, writeJson } from "../scripts/catalog-lib.mjs";
import { diffCatalogs, markdown, title } from "../scripts/catalog-diff.mjs";
import { validateCatalog } from "../scripts/validate.mjs";

test("the committed catalog validates", () => {
  assert.deepEqual(validateCatalog({ now: new Date("2026-08-11T12:00:00Z") }), []);
});

test("validation rejects stale unacknowledged prices and duplicate model keys", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-test-"));
  fs.cpSync(path.join(ROOT, "catalog"), path.join(temp, "catalog"), { recursive: true });
  fs.cpSync(path.join(ROOT, "schema"), path.join(temp, "schema"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "meta.json"), path.join(temp, "meta.json"));
  const imageFile = path.join(temp, "catalog/image.json");
  const videoFile = path.join(temp, "catalog/video_image_to_video.json");
  const image = JSON.parse(fs.readFileSync(imageFile));
  const video = JSON.parse(fs.readFileSync(videoFile));
  const provider = image.image.models["nano-banana-pro"].providers.fal;
  provider.price_last_verified = "2026-01-01";
  delete provider.price_stale_ack;
  video.video_image_to_video.models["nano-banana-pro"] = image.image.models["nano-banana-pro"];
  writeJson(imageFile, image);
  writeJson(videoFile, video);
  const errors = validateCatalog({ root: temp, now: new Date("2026-08-11T12:00:00Z") });
  assert(errors.some((error) => error.includes("price is 222 days old")));
  assert(errors.some((error) => error.includes("duplicate model key 'nano-banana-pro'")));
});

test("diff report puts harmful changes first and produces a readable title", () => {
  const before = structuredClone(loadCatalog());
  const after = structuredClone(before);
  delete after.image.models["nano-banana"].providers.muapi;
  after.image.models["nano-banana-pro"].providers.fal.unit_price_usd = 0.18;
  after.image.models["nano-banana-2"].providers.fal.supports = ["prompt"];
  after.image.models.new_model = structuredClone(after.image.models["nano-banana"]);
  const changes = diffCatalogs(before, after);
  assert.equal(title(changes), "catalog: 1 prices changed, 1 models added, 1 models gone");
  const body = markdown(changes);
  assert(body.indexOf("disappeared") < body.indexOf("Price increases"));
  assert(body.indexOf("Price increases") < body.indexOf("Supported arguments"));
  assert.match(body, /\+20\.0%/);
});
