# Event Handler Specification

## ResearchAssetPublished

1. Upsert raw event.
2. Fetch `walrus_blob_id`.
3. Extract `manifest.json`.
4. Verify `manifest_hash`.
5. Upsert `research_assets`.
6. Parse embedded skills and workflows.
7. Upsert relationships.
8. Generate search documents.
9. Generate embeddings.

## SkillPublished

1. Upsert skill.
2. Link source asset.
3. Link derived_from.
4. Link dependencies.
5. Update Skill graph.
6. Generate skill search doc.

## LicensePurchased

1. Upsert license.
2. Mark user has access.
3. Update sales stats.
4. Trigger unlock eligibility.

## CrossChainPaymentReceived

1. Verify order not processed in DB.
2. Link source chain tx.
3. Wait LicensePurchased or trigger reconciliation.
