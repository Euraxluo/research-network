#[allow(lint(self_transfer))]
module research_protocol::skill {
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::String;

    /// install_mode values carried by SkillInstalled.
    const INSTALL_MODE_FREE: u8 = 0;
    const INSTALL_MODE_ACCESS_PASS: u8 = 1;

    public struct SkillAsset has key, store {
        id: UID,
        owner: address,
        creator: address,
        name_hash: vector<u8>,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        source_asset_id: ID,
        derived_from: Option<ID>,
        dependencies: vector<ID>,
        created_ms: u64,
    }

    public struct SkillPublished has copy, drop {
        skill_id: ID,
        source_asset_id: ID,
        owner: address,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        derived_from: Option<ID>,
        dependencies: vector<ID>,
        created_ms: u64,
    }

    public struct SkillInstalled has copy, drop {
        skill_id: ID,
        workspace_asset_id: ID,
        installer: address,
        install_mode: u8,
        created_ms: u64,
    }

    public fun owner(skill: &SkillAsset): address { skill.owner }
    public fun id(skill: &SkillAsset): ID { object::id(skill) }
    public fun version(skill: &SkillAsset): String { skill.version }
    public fun created_ms(skill: &SkillAsset): u64 { skill.created_ms }
    public fun derived_from(skill: &SkillAsset): Option<ID> { skill.derived_from }
    public fun install_mode_free(): u8 { INSTALL_MODE_FREE }
    public fun install_mode_access_pass(): u8 { INSTALL_MODE_ACCESS_PASS }

    public fun publish_skill(
        name_hash: vector<u8>,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        source_asset_id: ID,
        derived_from: Option<ID>,
        dependencies: vector<ID>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let created_ms = clock::timestamp_ms(clock);
        let skill = SkillAsset {
            id: object::new(ctx),
            owner: sender,
            creator: sender,
            name_hash,
            version,
            manifest_hash,
            walrus_blob_id,
            source_asset_id,
            derived_from,
            dependencies,
            created_ms,
        };
        let skill_id = object::id(&skill);
        event::emit(SkillPublished {
            skill_id,
            source_asset_id: skill.source_asset_id,
            owner: sender,
            version: skill.version,
            manifest_hash: skill.manifest_hash,
            walrus_blob_id: skill.walrus_blob_id,
            derived_from: skill.derived_from,
            dependencies: skill.dependencies,
            created_ms,
        });
        sui::transfer::public_transfer(skill, sender);
    }

    /// Free install path: open to anyone. Restricted skills are distributed as encrypted
    /// research reports/packages and unlocked by Seal access policies, not by License NFTs.
    public fun install_skill(
        skill_id: ID,
        workspace_asset_id: ID,
        clock: &Clock,
        ctx: &TxContext
    ) {
        emit_installed(
            skill_id,
            workspace_asset_id,
            tx_context::sender(ctx),
            INSTALL_MODE_FREE,
            clock::timestamp_ms(clock),
        );
    }

    /// Emit a SkillInstalled event. Exposed to sibling modules so access-pass install paths
    /// can record the canonical event without creating dependency cycles.
    public(package) fun emit_installed(
        skill_id: ID,
        workspace_asset_id: ID,
        installer: address,
        install_mode: u8,
        created_ms: u64
    ) {
        event::emit(SkillInstalled {
            skill_id,
            workspace_asset_id,
            installer,
            install_mode,
            created_ms,
        });
    }
}
