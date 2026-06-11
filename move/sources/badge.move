module research_protocol::badge {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;

    public struct Badge has key, store {
        id: UID,
        asset_id: ID,
        recipient: address,
        issuer: address,
        badge_type: u8,
        metadata_hash: vector<u8>,
        created_ms: u64,
    }

    public struct BadgeIssued has copy, drop {
        badge_id: ID,
        asset_id: ID,
        recipient: address,
        issuer: address,
        badge_type: u8,
        metadata_hash: vector<u8>,
        created_ms: u64,
    }

    entry fun issue_badge(
        asset_id: ID,
        recipient: address,
        badge_type: u8,
        metadata_hash: vector<u8>,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        let issuer = tx_context::sender(ctx);
        let badge = Badge {
            id: object::new(ctx),
            asset_id,
            recipient,
            issuer,
            badge_type,
            metadata_hash,
            created_ms,
        };
        let badge_id = object::id(&badge);
        event::emit(BadgeIssued {
            badge_id,
            asset_id,
            recipient,
            issuer,
            badge_type,
            metadata_hash: badge.metadata_hash,
            created_ms,
        });
        sui::transfer::public_transfer(badge, recipient);
    }
}
