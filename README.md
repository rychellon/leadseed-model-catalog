# LeadSeed model catalog

Private, versioned provider facts consumed offline by the LeadSeed media-generation skill. Product routing does not live here.

## Layout

- `catalog/*.json` — one file per modality, preserving the skill's existing modality → models → providers shape.
- `meta.json` — release, schema, and provider credit-conversion metadata.
- `raw/` — provider responses preserved for audit and diffing.
- `schema/catalog.schema.json` — the machine-readable catalog contract.

Run `npm ci && npm run validate && npm test` before proposing a release.

## Release policy

- Patch: price or verification-date change.
- Minor: provider/model addition or a larger `supports` set.
- Major: schema change or a removed/renamed model key.

Every release receives a `vX.Y.Z` tag. Consumers pin tags and never fetch this repository during generation.

## Refresh policy

The weekly action fetches provider-owned data into `raw/`, re-verifies Fal prices through Fal's pricing API, and opens a draft PR. It never merges. Kie has no documented list-models API and its Market page blocks GitHub-hosted runners, so the job captures Kie's own machine-readable documentation index (`docs.kie.ai/llms.txt`) and leaves pricing human-reviewed.

The monthly action opens an issue grouped by provider for prices older than 45 days. A deliberate `price_stale_ack` keeps CI green but remains visible in that report.
