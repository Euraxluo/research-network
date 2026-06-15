#[test_only]
module research_protocol::skill_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use std::string;
    use research_protocol::skill::{Self, SkillAsset};

    const CREATOR: address = @0xA;
    const T0: u64 = 1_700_000_000_000;

    fun clock_at(ctx: &mut sui::tx_context::TxContext, t: u64): clock::Clock {
        let mut clk = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clk, t);
        clk
    }

    #[test]
    fun publish_skill_with_derived_from() {
        let mut sc = ts::begin(CREATOR);
        let parent = sui::object::id_from_address(@0xBEEF);
        let source = sui::object::id_from_address(@0xF00D);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            skill::publish_skill(
                b"my-skill",
                string::utf8(b"0.1.0"),
                b"manifest",
                b"walrus",
                source,
                option::some(parent),
                vector<sui::object::ID>[],
                &clk,
                ctx
            );
            clock::destroy_for_testing(clk);
        };
        ts::next_tx(&mut sc, CREATOR);
        let skill = ts::take_from_sender<SkillAsset>(&sc);
        assert!(skill::owner(&skill) == CREATOR, 0);
        assert!(skill::created_ms(&skill) == T0, 1);
        let df = skill::derived_from(&skill);
        assert!(option::is_some(&df), 2);
        assert!(*option::borrow(&df) == parent, 3);
        ts::return_to_sender(&sc, skill);
        ts::end(sc);
    }

    #[test]
    fun free_install_does_not_abort() {
        let mut sc = ts::begin(CREATOR);
        let ctx = ts::ctx(&mut sc);
        let clk = clock_at(ctx, T0);
        skill::install_skill(
            sui::object::id_from_address(@0x5),
            sui::object::id_from_address(@0x6),
            &clk,
            ctx
        );
        clock::destroy_for_testing(clk);
        ts::end(sc);
    }
}
