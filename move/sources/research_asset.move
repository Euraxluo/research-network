#[allow(lint(self_transfer))]
module research_protocol::research_asset {
    use sui::event;
    use sui::clock::{Self, Clock};
    use std::string::String;

    /// Caller does not own the asset they are trying to cite from / fork into.
    const E_NOT_OWNER: u64 = 3;

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

    public fun owner(asset: &ResearchAsset): address { asset.owner }
    public fun creator(asset: &ResearchAsset): address { asset.creator }
    public fun version(asset: &ResearchAsset): String { asset.version }
    public fun asset_type_mask(asset: &ResearchAsset): u64 { asset.asset_type_mask }
    public fun created_ms(asset: &ResearchAsset): u64 { asset.created_ms }

    public fun publish_research_asset(
        asset_type_mask: u64,
        version: String,
        manifest_hash: vector<u8>,
        walrus_blob_id: vector<u8>,
        repo_commit: vector<u8>,
        parent_assets: vector<ID>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let created_ms = clock::timestamp_ms(clock);
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

    /// Record that `src` (an asset the caller owns) cites `dst_asset_id`.
    /// Requiring `&src` proves the source asset exists and that the caller owns it,
    /// so the citation graph can only be written for real, owned assets.
    public fun cite_asset(
        src: &ResearchAsset,
        dst_asset_id: ID,
        relation_type: vector<u8>,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(src.owner == sender, E_NOT_OWNER);
        event::emit(AssetCited {
            src_asset_id: object::id(src),
            dst_asset_id,
            caller: sender,
            relation_type,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    /// Record that `child` (an asset the caller owns) was forked from `parent_asset_id`.
    /// Requiring `&child` proves the child asset exists and is owned by the caller.
    public fun record_fork(
        parent_asset_id: ID,
        child: &ResearchAsset,
        included_mask: u64,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(child.owner == sender, E_NOT_OWNER);
        event::emit(AssetForked {
            parent_asset_id,
            child_asset_id: object::id(child),
            caller: sender,
            included_mask,
            created_ms: clock::timestamp_ms(clock),
        });
    }
}
