#[test_only]
module research_protocol::payment_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use research_protocol::payment::{Self, SettlementRegistry, SettlerCap};

    const RELAYER: address = @0xA;
    const BUYER: address = @0xBEEF;
    const T0: u64 = 1_700_000_000_000;

    fun clock_at(ctx: &mut sui::tx_context::TxContext, t: u64): clock::Clock {
        let mut clk = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clk, t);
        clk
    }

    #[test]
    fun settle_records_and_marks_processed() {
        let mut sc = ts::begin(RELAYER);
        { let ctx = ts::ctx(&mut sc); payment::init_for_testing(ctx); };
        ts::next_tx(&mut sc, RELAYER);
        {
            let mut reg = ts::take_shared<SettlementRegistry>(&sc);
            let cap = ts::take_from_sender<SettlerCap>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let order = b"order-1";
            let chain = b"ethereum";
            let stx = b"0xdeadbeef";
            let att = payment::order_digest(&order, &chain, &stx, BUYER, 1000);
            payment::settle_cross_chain_payment(&mut reg, &cap, att, order, chain, stx, BUYER, 1000, &clk);
            assert!(payment::total_settled(&reg) == 1000, 0);
            assert!(payment::is_processed(&reg, &b"order-1"), 1);
            clock::destroy_for_testing(clk);
            ts::return_to_sender(&sc, cap);
            ts::return_shared(reg);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::payment::E_ALREADY_PROCESSED_ORDER)]
    fun duplicate_order_aborts() {
        let mut sc = ts::begin(RELAYER);
        { let ctx = ts::ctx(&mut sc); payment::init_for_testing(ctx); };
        ts::next_tx(&mut sc, RELAYER);
        {
            let mut reg = ts::take_shared<SettlementRegistry>(&sc);
            let cap = ts::take_from_sender<SettlerCap>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let order = b"order-1";
            let chain = b"eth";
            let stx = b"0x1";
            let att = payment::order_digest(&order, &chain, &stx, BUYER, 1000);
            payment::settle_cross_chain_payment(&mut reg, &cap, att, order, chain, stx, BUYER, 1000, &clk);
            // Replay the exact same order.
            let att2 = payment::order_digest(&order, &chain, &stx, BUYER, 1000);
            payment::settle_cross_chain_payment(&mut reg, &cap, att2, order, chain, stx, BUYER, 1000, &clk);
            clock::destroy_for_testing(clk);
            ts::return_to_sender(&sc, cap);
            ts::return_shared(reg);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::payment::E_INVALID_ATTESTATION)]
    fun bad_attestation_aborts() {
        let mut sc = ts::begin(RELAYER);
        { let ctx = ts::ctx(&mut sc); payment::init_for_testing(ctx); };
        ts::next_tx(&mut sc, RELAYER);
        {
            let mut reg = ts::take_shared<SettlementRegistry>(&sc);
            let cap = ts::take_from_sender<SettlerCap>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            payment::settle_cross_chain_payment(
                &mut reg, &cap, b"forged-attestation",
                b"order-1", b"eth", b"0x1", BUYER, 1000, &clk
            );
            clock::destroy_for_testing(clk);
            ts::return_to_sender(&sc, cap);
            ts::return_shared(reg);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::payment::E_UNAUTHORIZED_SETTLER)]
    fun unauthorized_cap_aborts() {
        let mut sc = ts::begin(RELAYER);
        { let ctx = ts::ctx(&mut sc); payment::init_for_testing(ctx); };
        ts::next_tx(&mut sc, RELAYER);
        {
            let mut reg = ts::take_shared<SettlementRegistry>(&sc);
            let ctx = ts::ctx(&mut sc);
            // A capability bound to a different (bogus) registry.
            let rogue_cap = payment::new_cap_for_testing(sui::object::id_from_address(@0xDEAD), ctx);
            let clk = clock_at(ctx, T0);
            let order = b"order-1";
            let chain = b"eth";
            let stx = b"0x1";
            let att = payment::order_digest(&order, &chain, &stx, BUYER, 1000);
            payment::settle_cross_chain_payment(&mut reg, &rogue_cap, att, order, chain, stx, BUYER, 1000, &clk);
            clock::destroy_for_testing(clk);
            std::unit_test::destroy(rogue_cap);
            ts::return_shared(reg);
        };
        ts::end(sc);
    }
}
