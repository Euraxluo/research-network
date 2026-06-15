#[test_only]
module research_protocol::revenue_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use research_protocol::revenue::{Self, RevenuePool};

    const A: address = @0xA;
    const B: address = @0xB;
    const C: address = @0xC;
    const T0: u64 = 1_700_000_000_000;

    fun clock_at(ctx: &mut sui::tx_context::TxContext, t: u64): clock::Clock {
        let mut clk = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clk, t);
        clk
    }

    fun new_pool(sc: &mut ts::Scenario, recipients: vector<address>, weights: vector<u64>) {
        let ctx = ts::ctx(sc);
        revenue::create_revenue_pool(sui::object::id_from_address(@0xA55E7), recipients, weights, ctx);
    }

    #[test]
    fun deposit_and_prorata_claim() {
        let mut sc = ts::begin(A);
        new_pool(&mut sc, vector[A, B], vector[6000, 4000]);

        // Deposit 1000 SUI.
        ts::next_tx(&mut sc, A);
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let c = coin::mint_for_testing<SUI>(1000, ctx);
            revenue::deposit(&mut pool, c, &clk, ctx);
            assert!(revenue::total_received(&pool) == 1000, 0);
            assert!(revenue::balance_value(&pool) == 1000, 1);
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };

        // A claims 60% = 600.
        ts::next_tx(&mut sc, A);
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            revenue::record_revenue_claim(&mut pool, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };
        ts::next_tx(&mut sc, A);
        {
            let c = ts::take_from_sender<coin::Coin<SUI>>(&sc);
            assert!(coin::value(&c) == 600, 2);
            coin::burn_for_testing(c);
        };

        // B claims 40% = 400.
        ts::next_tx(&mut sc, B);
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            revenue::record_revenue_claim(&mut pool, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };
        ts::next_tx(&mut sc, B);
        {
            let c = ts::take_from_sender<coin::Coin<SUI>>(&sc);
            assert!(coin::value(&c) == 400, 3);
            coin::burn_for_testing(c);
        };

        // Pool fully drained; bookkeeping recorded.
        ts::next_tx(&mut sc, A);
        {
            let pool = ts::take_shared<RevenuePool>(&sc);
            assert!(revenue::balance_value(&pool) == 0, 4);
            assert!(revenue::claimed_by(&pool, A) == 600, 5);
            assert!(revenue::claimed_by(&pool, B) == 400, 6);
            ts::return_shared(pool);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::revenue::E_NOTHING_TO_CLAIM)]
    fun double_claim_aborts() {
        let mut sc = ts::begin(A);
        new_pool(&mut sc, vector[A, B], vector[6000, 4000]);
        ts::next_tx(&mut sc, A);
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let c = coin::mint_for_testing<SUI>(1000, ctx);
            revenue::deposit(&mut pool, c, &clk, ctx);
            revenue::record_revenue_claim(&mut pool, &clk, ctx); // 600
            revenue::record_revenue_claim(&mut pool, &clk, ctx); // nothing new -> abort
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::revenue::E_NOT_RECIPIENT)]
    fun non_recipient_claim_aborts() {
        let mut sc = ts::begin(A);
        new_pool(&mut sc, vector[A, B], vector[6000, 4000]);
        ts::next_tx(&mut sc, A);
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let c = coin::mint_for_testing<SUI>(1000, ctx);
            revenue::deposit(&mut pool, c, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };
        ts::next_tx(&mut sc, C); // C is not a recipient
        {
            let mut pool = ts::take_shared<RevenuePool>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            revenue::record_revenue_claim(&mut pool, &clk, ctx); // abort
            clock::destroy_for_testing(clk);
            ts::return_shared(pool);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::revenue::E_INVALID_BPS_SUM)]
    fun bad_bps_sum_aborts() {
        let mut sc = ts::begin(A);
        new_pool(&mut sc, vector[A, B], vector[6000, 3000]); // sums to 9000
        ts::end(sc);
    }
}
