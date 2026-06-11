module research_protocol::research_asset {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::string::String;
    use std::option::Option;

    public struct ResearchAsset has key, store {
        id: UID,
        owner: address,
        creator: address,
        asset_type_mask: u64,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        repo_commit: vector<u8>,
        parent_assets: vector<ID>,
        created_ms: u64,
    }

    public struct ResearchAssetPublished has copy, drop {
        asset_id: ID,
        owner: address,
        creator: address,
        asset_type_mask: u64,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        repo_commit: vector<u8>,
        created_ms: u64,
    }

    public struct AssetCited has copy, drop {
        src_asset_id: ID,
        dst_asset_id: ID,
        caller: address,
        relation_type: vector<u8>,
        created_ms: u64,
    }

    public struct AssetForked has copy, drop {
        parent_asset_id: ID,
        child_asset_id: ID,
        caller: address,
        included_mask: u64,
        created_ms: u64,
    }

    entry fun publish_research_asset(
        asset_type_mask: u64,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        repo_commit: vector<u8>,
        parent_assets: vector<ID>,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let asset = ResearchAsset {
            id: object::new(ctx),
            owner: sender,
            creator: sender,
            asset_type_mask,
            version,
            manifest_hash,
            walrus_blob_id,
            repo_commit,
            parent_assets,
            created_ms,
        };
        let asset_id = object::id(&asset);
        event::emit(ResearchAssetPublished {
            asset_id,
            owner: sender,
            creator: sender,
            asset_type_mask: asset.asset_type_mask,
            version: asset.version,
            manifest_hash: asset.manifest_hash,
            walrus_blob_id: asset.walrus_blob_id,
            repo_commit: asset.repo_commit,
            created_ms,
        });
        sui::transfer::public_transfer(asset, sender);
    }

    entry fun cite_asset(
        src_asset_id: ID,
        dst_asset_id: ID,
        relation_type: vector<u8>,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        event::emit(AssetCited {
            src_asset_id,
            dst_asset_id,
            caller: tx_context::sender(ctx),
            relation_type,
            created_ms,
        });
    }

    entry fun record_fork(
        parent_asset_id: ID,
        child_asset_id: ID,
        included_mask: u64,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        event::emit(AssetForked {
            parent_asset_id,
            child_asset_id,
            caller: tx_context::sender(ctx),
            included_mask,
            created_ms,
        });
    }
}
