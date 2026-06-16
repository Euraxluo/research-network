#[test_only]
module research_protocol::access_delegation_tests {
    use sui::test_scenario::{Self as ts};
    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use research_protocol::access::{Self, AgentSubscriptionPass, PlatformMembershipPass};
    use research_protocol::delegation::{Self, DelegationJob};
    use research_protocol::report::{Self, ResearchReport};
    use research_protocol::settlement::{Self, AgentEarnings, MembershipReceiptRegistry, SettlementConfig};

    const AGENT: address = @0xA;
    const BUYER: address = @0xB;
    const OUTSIDER: address = @0xC;
    const ARBITRATOR: address = @0xD;
    const T0: u64 = 1_700_000_000_000;

    fun clock_at(ctx: &mut sui::tx_context::TxContext, t: u64): clock::Clock {
        let mut clk = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut clk, t);
        clk
    }

    fun init_settlement(sc: &mut ts::Scenario) {
        let ctx = ts::ctx(sc);
        settlement::init_for_testing(ctx);
    }

    #[test]
    fun encrypted_report_allows_platform_member_and_agent_subscriber() {
        let mut sc = ts::begin(AGENT);
        init_settlement(&mut sc);

        ts::next_tx(&mut sc, AGENT);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_encrypted_report(b"walrus", b"seal", b"cipher", b"plain", b"preview", 1, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let config = ts::take_shared<SettlementConfig>(&sc);
            let mut earnings = ts::take_shared<AgentEarnings>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let member_pay = coin::mint_for_testing<SUI>(1000, ctx);
            settlement::buy_platform_membership(&config, member_pay, 1, 1_000, &clk, ctx);
            let sub_pay = coin::mint_for_testing<SUI>(1000, ctx);
            settlement::buy_agent_subscription(&config, &mut earnings, AGENT, sub_pay, 1, 1_000, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(config);
            ts::return_shared(earnings);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let platform_pass = ts::take_from_sender<PlatformMembershipPass>(&sc);
            let agent_pass = ts::take_from_sender<AgentSubscriptionPass>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 10);
            // seal_approve now takes the Seal identity (report object id bytes)
            // as its first arg and aborts on denial; calling it succeeds here.
            let id = report::seal_id(&report);
            access::seal_approve_report_with_platform_membership(id, &report, &platform_pass, &clk, ctx);
            access::seal_approve_report_with_agent_subscription(id, &report, &agent_pass, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_to_address(AGENT, report);
            ts::return_to_sender(&sc, platform_pass);
            ts::return_to_sender(&sc, agent_pass);
        };
        ts::end(sc);
    }

    #[test, expected_failure(abort_code = 23)]
    fun expired_platform_membership_denies_encrypted_report() {
        let mut sc = ts::begin(AGENT);
        init_settlement(&mut sc);

        ts::next_tx(&mut sc, AGENT);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_encrypted_report(b"walrus", b"seal", b"cipher", b"plain", b"preview", 1, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let config = ts::take_shared<SettlementConfig>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let pay = coin::mint_for_testing<SUI>(1000, ctx);
            settlement::buy_platform_membership(&config, pay, 1, 5, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(config);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let pass = ts::take_from_sender<PlatformMembershipPass>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 10);
            // Expired membership (duration 5ms, clock is T0+10) -> abort E_NOT_AUTHORIZED (23).
            let id = report::seal_id(&report);
            access::seal_approve_report_with_platform_membership(id, &report, &pass, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_to_address(AGENT, report);
            ts::return_to_sender(&sc, pass);
        };
        ts::end(sc);
    }

    #[test]
    fun private_delegation_allows_parties_and_dispute_arbitrator() {
        let mut sc = ts::begin(BUYER);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            delegation::create_delegation_job(AGENT, b"question", b"source", 1000, T0 + 10_000, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, AGENT);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            delegation::accept_delegation_job(&mut job, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let pay = coin::mint_for_testing<SUI>(1000, ctx);
            delegation::fund_delegation_job(&mut job, pay, 1000, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, AGENT);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_private_result(&mut job, b"walrus", b"seal", b"cipher", b"plain", b"preview", &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let job = ts::take_shared<DelegationJob>(&sc);
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let ctx = ts::ctx(&mut sc);
            // Buyer is a private-delegation party -> approve succeeds.
            let id = report::seal_id(&report);
            access::seal_approve_private_result(id, &report, &job, ctx);
            ts::return_shared(job);
            ts::return_to_address(AGENT, report);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            delegation::open_dispute(&mut job, ARBITRATOR, b"reason", &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, ARBITRATOR);
        {
            let job = ts::take_shared<DelegationJob>(&sc);
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let ctx = ts::ctx(&mut sc);
            // After open_dispute the arbitrator can decrypt -> approve succeeds.
            let id = report::seal_id(&report);
            access::seal_approve_private_result(id, &report, &job, ctx);
            ts::return_shared(job);
            ts::return_to_address(AGENT, report);
        };
        ts::end(sc);
    }

    /// Separated deny case: an outsider calling seal_approve_private_result must
    /// abort (E_NOT_AUTHORIZED = 23), since seal_approve now denies via abort.
    #[test, expected_failure(abort_code = 23)]
    fun private_delegation_denies_outsider() {
        let mut sc = ts::begin(BUYER);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            delegation::create_delegation_job(AGENT, b"question", b"source", 1000, T0 + 10_000, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, AGENT);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            delegation::accept_delegation_job(&mut job, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let pay = coin::mint_for_testing<SUI>(1000, ctx);
            delegation::fund_delegation_job(&mut job, pay, 1000, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, AGENT);
        {
            let mut job = ts::take_shared<DelegationJob>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_private_result(&mut job, b"walrus", b"seal", b"cipher", b"plain", b"preview", &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(job);
        };

        ts::next_tx(&mut sc, OUTSIDER);
        {
            let job = ts::take_shared<DelegationJob>(&sc);
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let ctx = ts::ctx(&mut sc);
            let id = report::seal_id(&report);
            access::seal_approve_private_result(id, &report, &job, ctx);
            ts::return_shared(job);
            ts::return_to_address(AGENT, report);
        };
        ts::end(sc);
    }

    #[test]
    fun membership_receipt_settles_agent_earnings_once() {
        let mut sc = ts::begin(AGENT);
        init_settlement(&mut sc);

        ts::next_tx(&mut sc, AGENT);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_encrypted_report(b"walrus", b"seal", b"cipher", b"plain", b"preview", 1, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let config = ts::take_shared<SettlementConfig>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let pay = coin::mint_for_testing<SUI>(1000, ctx);
            settlement::buy_platform_membership(&config, pay, 1, 1_000, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(config);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut registry = ts::take_shared<MembershipReceiptRegistry>(&sc);
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let pass = ts::take_from_sender<PlatformMembershipPass>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 10);
            settlement::record_platform_access_receipt(&mut registry, &pass, &report, 202606, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(registry);
            ts::return_to_address(AGENT, report);
            ts::return_to_sender(&sc, pass);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut earnings = ts::take_shared<AgentEarnings>(&sc);
            let receipt = ts::take_from_sender<access::AccessReceipt>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 20);
            let share = coin::mint_for_testing<SUI>(500, ctx);
            settlement::settle_membership_report(&mut earnings, &receipt, share, 1, &clk, ctx);
            assert!(settlement::agent_balance(&earnings, AGENT) == 500, 0);
            clock::destroy_for_testing(clk);
            ts::return_shared(earnings);
            ts::return_to_sender(&sc, receipt);
        };

        ts::next_tx(&mut sc, AGENT);
        {
            let mut earnings = ts::take_shared<AgentEarnings>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 30);
            settlement::claim_agent_earnings(&mut earnings, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(earnings);
        };
        ts::next_tx(&mut sc, AGENT);
        {
            let payout = ts::take_from_sender<coin::Coin<SUI>>(&sc);
            assert!(coin::value(&payout) == 500, 1);
            coin::burn_for_testing(payout);
        };
        ts::end(sc);
    }

    #[test]
    #[expected_failure(abort_code = research_protocol::settlement::E_ALREADY_RECORDED)]
    fun duplicate_membership_receipt_aborts() {
        let mut sc = ts::begin(AGENT);
        init_settlement(&mut sc);

        ts::next_tx(&mut sc, AGENT);
        {
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            report::publish_encrypted_report(b"walrus", b"seal", b"cipher", b"plain", b"preview", 1, &clk, ctx);
            clock::destroy_for_testing(clk);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let config = ts::take_shared<SettlementConfig>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0);
            let pay = coin::mint_for_testing<SUI>(1000, ctx);
            settlement::buy_platform_membership(&config, pay, 1, 1_000, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(config);
        };

        ts::next_tx(&mut sc, BUYER);
        {
            let mut registry = ts::take_shared<MembershipReceiptRegistry>(&sc);
            let report = ts::take_from_address<ResearchReport>(&sc, AGENT);
            let pass = ts::take_from_sender<PlatformMembershipPass>(&sc);
            let ctx = ts::ctx(&mut sc);
            let clk = clock_at(ctx, T0 + 10);
            settlement::record_platform_access_receipt(&mut registry, &pass, &report, 202606, &clk, ctx);
            settlement::record_platform_access_receipt(&mut registry, &pass, &report, 202606, &clk, ctx);
            clock::destroy_for_testing(clk);
            ts::return_shared(registry);
            ts::return_to_address(AGENT, report);
            ts::return_to_sender(&sc, pass);
        };
        ts::end(sc);
    }
}
