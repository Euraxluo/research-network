module research_protocol::skill {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::string::String;
    use std::option::Option;

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

    entry fun publish_skill(
        name_hash: vector<u8>,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        source_asset_id: ID,
        derived_from: Option<ID>,
        dependencies: vector<ID>,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
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

    entry fun install_skill(
        skill_id: ID,
        workspace_asset_id: ID,
        install_mode: u8,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        event::emit(SkillInstalled {
            skill_id,
            workspace_asset_id,
            installer: tx_context::sender(ctx),
            install_mode,
            created_ms,
        });
    }
}
