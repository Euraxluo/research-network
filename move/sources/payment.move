module research_protocol::payment {
    use sui::event;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::hash;
    use std::bcs;

    const E_ALREADY_PROCESSED_ORDER: u64 = 5;
    /// The settler capability does not belong to this registry.
    const E_UNAUTHORIZED_SETTLER: u64 = 11;
    /// The supplied attestation does not bind the order fields.
    const E_INVALID_ATTESTATION: u64 = 13;

    /// Shared registry of settled cross-chain orders. Uses a Table for O(1) idempotent
    /// dedup (the previous vector scan grew gas without bound as orders accumulated).
    public struct SettlementRegistry has key {
        id: UID,
        processed_orders: Table<vector<u8>, bool>,
        total_settled: u64,
    }

    /// Capability authorizing its holder to settle into a specific registry. Minted once at
    /// publish to the deployer; the protocol can transfer it to a trusted relayer/oracle.
    public struct SettlerCap has key, store {
        id: UID,
        registry_id: ID,
    }

    public struct CrossChainPaymentReceived has copy, drop {
        order_hash: vector<u8>,
        source_chain: vector<u8>,
        source_tx: vector<u8>,
        buyer: address,
        amount: u64,
        created_ms: u64,
    }

    fun init(ctx: &mut TxContext) {
        let registry = SettlementRegistry {
            id: object::new(ctx),
            processed_orders: table::new(ctx),
            total_settled: 0,
        };
        let registry_id = object::id(&registry);
        transfer::share_object(registry);
        transfer::public_transfer(
            SettlerCap { id: object::new(ctx), registry_id },
            tx_context::sender(ctx)
        );
    }

    public fun registry_id(registry: &SettlementRegistry): ID { object::id(registry) }
    public fun total_settled(registry: &SettlementRegistry): u64 { registry.total_settled }
    public fun is_processed(registry: &SettlementRegistry, order_hash: &vector<u8>): bool {
        table::contains(&registry.processed_orders, *order_hash)
    }

    /// Canonical digest binding all order fields. A relayer/oracle computes this off-chain
    /// from the verified source-chain message and passes it as `attestation`.
    public fun order_digest(
        order_hash: &vector<u8>,
        source_chain: &vector<u8>,
        source_tx: &vector<u8>,
        buyer: address,
        amount: u64
    ): vector<u8> {
        let mut bytes = vector<u8>[];
        vector::append(&mut bytes, *order_hash);
        vector::append(&mut bytes, *source_chain);
        vector::append(&mut bytes, *source_tx);
        vector::append(&mut bytes, bcs::to_bytes(&buyer));
        vector::append(&mut bytes, bcs::to_bytes(&amount));
        hash::blake2b256(&bytes)
    }

    /// Settle a cross-chain payment. v2 enforces three controls the skeleton lacked:
    ///   1. capability authorization (`&SettlerCap` bound to this registry),
    ///   2. attestation binding (the attestation must equal the canonical order digest),
    ///   3. idempotent dedup via Table (O(1), replay-safe).
    /// NOTE: full CCTP/Wormhole guardian-signature VAA verification is out of scope here and
    /// remains future work; this binds the order and gates settlement behind a trusted cap.
    public fun settle_cross_chain_payment(
        registry: &mut SettlementRegistry,
        cap: &SettlerCap,
        attestation: vector<u8>,
        order_hash: vector<u8>,
        source_chain: vector<u8>,
        source_tx: vector<u8>,
        buyer: address,
        amount: u64,
        clock: &Clock
    ) {
        assert!(cap.registry_id == object::id(registry), E_UNAUTHORIZED_SETTLER);
        assert!(!table::contains(&registry.processed_orders, order_hash), E_ALREADY_PROCESSED_ORDER);
        let digest = order_digest(&order_hash, &source_chain, &source_tx, buyer, amount);
        assert!(attestation == digest, E_INVALID_ATTESTATION);

        table::add(&mut registry.processed_orders, order_hash, true);
        registry.total_settled = registry.total_settled + amount;
        event::emit(CrossChainPaymentReceived {
            order_hash,
            source_chain,
            source_tx,
            buyer,
            amount,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }

    #[test_only]
    public fun new_cap_for_testing(registry_id: ID, ctx: &mut TxContext): SettlerCap {
        SettlerCap { id: object::new(ctx), registry_id }
    }
}
