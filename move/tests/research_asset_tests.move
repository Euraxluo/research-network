#[test_only]
module research_protocol::research_asset_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use std::string;
    use research_protocol::research_asset::{Self as ra, ResearchAsset};

    const CREATOR: address = @0xA;
    const OTHER: address = @0xB;
    const T0: u64 = 1_700_000_000_000;

    fun publish_as(sc: &mut ts::Scenario, who: address, mask: u64) {
        ts::next_tx(sc, who);
        let ctx = ts::ctx(sc);
        let clk = clock_at(ctx, T0);
        ra::publish_research_asset(
            mask,
            string::utf8(b"0.1.0"),
            b"manifest-hash",
            b"walrus-blob",
            b"repo-commit",
            vector<sui::object::ID>[],
            &clk,
            ctx
        );
        clock::destroy_for_testing(clk);
    }

    fun clock_at(ctx: &mut sui::tx_context::TxContext, t: u64): clock::Clock {
        let mut clk = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clk, t);
        clk
    }

    #[test]
    fun publish_sets_fields_and_uses_clock_time() {
        let mut sc = ts::begin(CREATOR);
        publish_as(&mut sc, CREATOR, 7); // paper|skill|workflow
        ts::next_tx(&mut sc, CREATOR);
        let asset = ts::take_from_sender<ResearchAsset>(&sc);
        assert!(ra::owner(&asset) == CREATOR, 0);
        assert!(ra::creator(&asset) == CREATOR, 1);
        assert!(ra::asset_type_mask(&asset) == 7, 2);
        assert!(ra::created_ms(&asset) == T0, 3); // timestamp came from on-chain Clock
        ts::return_to_sender(&sc, asset);
        ts::end(sc);
    }

    #[test]
    fun cite_by_owner_succeeds() {
        let mut sc = ts::begin(CREATOR);
        publish_as(&mut sc, CREATOR, 1);
        ts::next_tx(&mut sc, CREATOR);
        let asset = ts::take_from_sender<ResearchAsset>(&sc);
        let ctx = ts::ctx(&mut sc);
        let clk = clock_at(ctx, T0);
        ra::cite_asset(&asset, sui::object::id_from_address(@0xCAFE), b"cites", &clk, ctx);
        clock::destroy_for_testing(clk);
        ts::return_to_sender(&sc, asset);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::research_asset::E_NOT_OWNER)]
    fun cite_by_non_owner_aborts() {
        let mut sc = ts::begin(CREATOR);
        publish_as(&mut sc, CREATOR, 1);
        // OTHER tries to cite from CREATOR's asset.
        ts::next_tx(&mut sc, OTHER);
        let asset = ts::take_from_address<ResearchAsset>(&sc, CREATOR);
        let ctx = ts::ctx(&mut sc);
        let clk = clock_at(ctx, T0);
        ra::cite_asset(&asset, sui::object::id_from_address(@0xCAFE), b"cites", &clk, ctx);
        clock::destroy_for_testing(clk);
        ts::return_to_address(CREATOR, asset);
        ts::end(sc);
    }

    #[test]
    fun fork_by_owner_succeeds() {
        let mut sc = ts::begin(CREATOR);
        publish_as(&mut sc, CREATOR, 1);
        ts::next_tx(&mut sc, CREATOR);
        let child = ts::take_from_sender<ResearchAsset>(&sc);
        let ctx = ts::ctx(&mut sc);
        let clk = clock_at(ctx, T0);
        ra::record_fork(sui::object::id_from_address(@0xBEEF), &child, 5, &clk, ctx);
        clock::destroy_for_testing(clk);
        ts::return_to_sender(&sc, child);
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::research_asset::E_NOT_OWNER)]
    fun fork_by_non_owner_aborts() {
        let mut sc = ts::begin(CREATOR);
        publish_as(&mut sc, CREATOR, 1);
        ts::next_tx(&mut sc, OTHER);
        let child = ts::take_from_address<ResearchAsset>(&sc, CREATOR);
        let ctx = ts::ctx(&mut sc);
        let clk = clock_at(ctx, T0);
        ra::record_fork(sui::object::id_from_address(@0xBEEF), &child, 5, &clk, ctx);
        clock::destroy_for_testing(clk);
        ts::return_to_address(CREATOR, child);
        ts::end(sc);
    }
}
