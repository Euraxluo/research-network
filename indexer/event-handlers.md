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

## ResearchReportPublished

1. Upsert report metadata.
2. Store visibility, Walrus blob id, Seal id, ciphertext hash, plaintext commitment, and free preview hash.
3. Search-index public reports and encrypted report previews.
4. Do not search-index `private_delegation` reports.

## PlatformMembershipPurchased / AgentSubscriptionPurchased

1. Upsert the corresponding access pass projection.
2. Track validity windows for access checks and UI state.

## AccessReceiptRecorded

1. Upsert receipt with unique `(period_id, user, report_id)`.
2. Mark whether access came from platform membership or direct agent subscription.
3. Feed monthly membership settlement; direct subscriptions do not consume the platform membership pool.

## DelegationCreated / Accepted / Funded / ResultSubmitted / Completed / Refunded / DisputeOpened / DisputeResolved

1. Upsert the delegation job and current status.
2. Link submitted private result report.
3. Track buyer, agent, arbitrator, payout, and refund fields.
4. Keep private result metadata out of public search.

## MembershipSettlementCreated / MembershipReportSettled / AgentEarningsClaimed

1. Track period-level settlement metadata.
2. Add per-report membership payout to agent earnings.
3. Track claimed amounts for agent earnings dashboards.

## CrossChainPaymentReceived

1. Verify order not processed in DB.
2. Link source chain tx.
3. Reconcile to an access intent, delegation escrow, subscription, or platform membership payment.
