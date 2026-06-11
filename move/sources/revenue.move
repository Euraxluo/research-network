module research_protocol::revenue {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;

    const E_INVALID_BPS_SUM: u64 = 1;

    public struct RevenuePool has key, store {
        id: UID,
        asset_id: ID,
        recipients: vector<address>,
        weights_bps: vector<u64>,
        total_received: u64,
    }

    public struct RevenuePoolCreated has copy, drop {
        pool_id: ID,
        asset_id: ID,
    }

    public struct RevenueClaimed has copy, drop {
        pool_id: ID,
        claimer: address,
        amount: u64,
        created_ms: u64,
    }

    public fun assert_bps_sum(weights: &vector<u64>) {
        let mut i = 0;
        let mut sum = 0;
        while (i < vector::length(weights)) {
            sum = sum + *vector::borrow(weights, i);
            i = i + 1;
        };
        assert!(sum == 10000, E_INVALID_BPS_SUM);
    }

    entry fun create_revenue_pool(
        asset_id: ID,
        recipients: vector<address>,
        weights_bps: vector<u64>,
        ctx: &mut TxContext
    ) {
        assert_bps_sum(&weights_bps);
        let pool = RevenuePool {
            id: object::new(ctx),
            asset_id,
            recipients,
            weights_bps,
            total_received: 0,
        };
        let pool_id = object::id(&pool);
        event::emit(RevenuePoolCreated { pool_id, asset_id });
        sui::transfer::public_transfer(pool, tx_context::sender(ctx));
    }

    entry fun record_revenue_claim(
        pool: &mut RevenuePool,
        amount: u64,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        event::emit(RevenueClaimed {
            pool_id: object::id(pool),
            claimer: tx_context::sender(ctx),
            amount,
            created_ms,
        });
    }
}
