module research_protocol::payment {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::transfer;

    const E_DUPLICATE_ORDER: u64 = 1;

    public struct SettlementRegistry has key {
        id: UID,
        processed_orders: vector<vector<u8>>,
    }

    public struct ProcessedOrder has key, store {
        id: UID,
        order_hash: vector<u8>,
    }

    public struct CrossChainPaymentReceived has copy, drop {
        order_hash: vector<u8>,
        source_chain: vector<u8>,
        source_tx: vector<u8>,
        buyer: address,
        amount: u64,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(SettlementRegistry {
            id: object::new(ctx),
            processed_orders: vector::empty(),
        });
    }

    public fun contains_order(registry: &SettlementRegistry, order_hash: &vector<u8>): bool {
        let mut i = 0;
        while (i < vector::length(&registry.processed_orders)) {
            if (vector::borrow(&registry.processed_orders, i) == order_hash) {
                return true
            };
            i = i + 1;
        };
        false
    }

    entry fun settle_cross_chain_payment(
        registry: &mut SettlementRegistry,
        order_hash: vector<u8>,
        source_chain: vector<u8>,
        source_tx: vector<u8>,
        buyer: address,
        amount: u64,
        ctx: &mut TxContext
    ) {
        assert!(!contains_order(registry, &order_hash), E_DUPLICATE_ORDER);
        vector::push_back(&mut registry.processed_orders, order_hash);
        let stored_order = *vector::borrow(&registry.processed_orders, vector::length(&registry.processed_orders) - 1);
        let marker = ProcessedOrder { id: object::new(ctx), order_hash };
        event::emit(CrossChainPaymentReceived {
            order_hash: stored_order,
            source_chain,
            source_tx,
            buyer,
            amount,
        });
        sui::transfer::public_transfer(marker, tx_context::sender(ctx));
    }

    public fun registry_id(registry: &SettlementRegistry): ID {
        object::id(registry)
    }
}
