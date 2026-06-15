#[allow(lint(self_transfer))]
module research_protocol::settlement {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;
    use sui::table::{Self, Table};
    use std::bcs;
    use research_protocol::access::{Self, AccessReceipt};
    use research_protocol::report::ResearchReport;

    const E_INVALID_FEE_BPS: u64 = 30;
    const E_INSUFFICIENT_PAYMENT: u64 = 31;
    const E_NOTHING_TO_CLAIM: u64 = 32;
    const E_ALREADY_RECORDED: u64 = 33;
    const E_BAD_SETTLEMENT_INPUT: u64 = 34;

    public struct SettlementConfig has key {
        id: UID,
        platform_treasury: address,
        platform_fee_bps: u64,
    }

    public struct AgentChannel has key, store {
        id: UID,
        agent: address,
        metadata_hash: vector<u8>,
        created_ms: u64,
    }

    public struct AgentEarnings has key {
        id: UID,
        agent_balances: Table<address, u64>,
        claimed: Table<address, u64>,
        balance: Balance<SUI>,
    }

    public struct MembershipReceiptRegistry has key {
        id: UID,
        seen: Table<vector<u8>, bool>,
    }

    public struct AgentChannelCreated has copy, drop {
        channel_id: ID,
        agent: address,
        metadata_hash: vector<u8>,
        created_ms: u64,
    }

    public struct PlatformMembershipPaid has copy, drop {
        buyer: address,
        amount: u64,
        platform_fee: u64,
        duration_ms: u64,
        created_ms: u64,
    }

    public struct AgentSubscriptionPaid has copy, drop {
        buyer: address,
        agent: address,
        amount: u64,
        platform_fee: u64,
        duration_ms: u64,
        created_ms: u64,
    }

    public struct MembershipSettlementCreated has copy, drop {
        period_id: u64,
        user: address,
        report_count: u64,
        net_amount: u64,
        amount_per_report: u64,
        created_ms: u64,
    }

    public struct MembershipReportSettled has copy, drop {
        period_id: u64,
        user: address,
        report_id: ID,
        agent: address,
        amount: u64,
        created_ms: u64,
    }

    public struct AgentEarningsClaimed has copy, drop {
        agent: address,
        amount: u64,
        created_ms: u64,
    }

    fun init(ctx: &mut TxContext) {
        let config = SettlementConfig {
            id: object::new(ctx),
            platform_treasury: tx_context::sender(ctx),
            platform_fee_bps: 2000,
        };
        let earnings = AgentEarnings {
            id: object::new(ctx),
            agent_balances: table::new(ctx),
            claimed: table::new(ctx),
            balance: balance::zero<SUI>(),
        };
        let registry = MembershipReceiptRegistry {
            id: object::new(ctx),
            seen: table::new(ctx),
        };
        transfer::share_object(config);
        transfer::share_object(earnings);
        transfer::share_object(registry);
    }

    public fun platform_fee_bps(config: &SettlementConfig): u64 { config.platform_fee_bps }
    public fun platform_treasury(config: &SettlementConfig): address { config.platform_treasury }
    public fun agent_balance(earnings: &AgentEarnings, agent: address): u64 {
        if (table::contains(&earnings.agent_balances, agent)) {
            *table::borrow(&earnings.agent_balances, agent)
        } else {
            0
        }
    }

    public fun create_agent_channel(
        metadata_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let agent = tx_context::sender(ctx);
        let channel = AgentChannel {
            id: object::new(ctx),
            agent,
            metadata_hash,
            created_ms: clock::timestamp_ms(clock),
        };
        event::emit(AgentChannelCreated {
            channel_id: object::id(&channel),
            agent,
            metadata_hash: channel.metadata_hash,
            created_ms: channel.created_ms,
        });
        transfer::public_transfer(channel, agent);
    }

    fun split_fee(config: &SettlementConfig, amount: u64): (u64, u64) {
        assert!(config.platform_fee_bps <= 10000, E_INVALID_FEE_BPS);
        let platform_fee = (((amount as u128) * (config.platform_fee_bps as u128)) / 10000) as u64;
        (platform_fee, amount - platform_fee)
    }

    fun credit_agent(earnings: &mut AgentEarnings, agent: address, amount: u64) {
        if (table::contains(&earnings.agent_balances, agent)) {
            *table::borrow_mut(&mut earnings.agent_balances, agent) = *table::borrow(&earnings.agent_balances, agent) + amount;
        } else {
            table::add(&mut earnings.agent_balances, agent, amount);
        }
    }

    public fun buy_platform_membership(
        config: &SettlementConfig,
        payment: Coin<SUI>,
        tier: u8,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);
        let amount = coin::value(&payment);
        assert!(amount > 0, E_INSUFFICIENT_PAYMENT);
        let (platform_fee, net) = split_fee(config, amount);
        transfer::public_transfer(payment, config.platform_treasury);
        access::mint_platform_membership_pass(buyer, tier, duration_ms, clock, ctx);
        event::emit(PlatformMembershipPaid {
            buyer,
            amount,
            platform_fee,
            duration_ms,
            created_ms: clock::timestamp_ms(clock),
        });
        // The net portion is accounted at membership settlement time from the platform's
        // off-chain payment ledger; this event records the fee split applied to the payment.
        let _ = net;
    }

    public fun buy_agent_subscription(
        config: &SettlementConfig,
        earnings: &mut AgentEarnings,
        agent: address,
        payment: Coin<SUI>,
        tier: u8,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);
        let amount = coin::value(&payment);
        assert!(amount > 0, E_INSUFFICIENT_PAYMENT);
        let (platform_fee, net) = split_fee(config, amount);
        let mut payment = payment;
        let agent_coin = coin::split(&mut payment, net, ctx);
        balance::join(&mut earnings.balance, coin::into_balance(agent_coin));
        credit_agent(earnings, agent, net);
        if (coin::value(&payment) > 0) {
            transfer::public_transfer(payment, config.platform_treasury);
        } else {
            coin::destroy_zero(payment);
        };
        access::mint_agent_subscription_pass(buyer, agent, tier, duration_ms, clock, ctx);
        event::emit(AgentSubscriptionPaid {
            buyer,
            agent,
            amount,
            platform_fee,
            duration_ms,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun record_platform_access_receipt(
        registry: &mut MembershipReceiptRegistry,
        pass: &access::PlatformMembershipPass,
        report: &ResearchReport,
        period_id: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        access::assert_platform_membership_access(pass, report, clock, ctx);
        let user = tx_context::sender(ctx);
        let mut key = bcs::to_bytes(&period_id);
        vector::append(&mut key, bcs::to_bytes(&user));
        vector::append(&mut key, bcs::to_bytes(&research_protocol::report::id(report)));
        assert!(!table::contains(&registry.seen, key), E_ALREADY_RECORDED);
        table::add(&mut registry.seen, key, true);
        let receipt = access::record_access_receipt(
            period_id,
            user,
            report,
            access::receipt_platform_member(),
            clock,
            ctx,
        );
        transfer::public_transfer(receipt, user);
    }

    public fun settle_membership_report(
        earnings: &mut AgentEarnings,
        receipt: &AccessReceipt,
        amount_per_report: Coin<SUI>,
        report_count: u64,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        assert!(report_count > 0, E_BAD_SETTLEMENT_INPUT);
        let amount = coin::value(&amount_per_report);
        assert!(amount > 0, E_BAD_SETTLEMENT_INPUT);
        balance::join(&mut earnings.balance, coin::into_balance(amount_per_report));
        let agent = access::receipt_agent(receipt);
        credit_agent(earnings, agent, amount);
        event::emit(MembershipSettlementCreated {
            period_id: access::receipt_period_id(receipt),
            user: access::receipt_user(receipt),
            report_count,
            net_amount: amount * report_count,
            amount_per_report: amount,
            created_ms: clock::timestamp_ms(clock),
        });
        event::emit(MembershipReportSettled {
            period_id: access::receipt_period_id(receipt),
            user: access::receipt_user(receipt),
            report_id: access::receipt_report_id(receipt),
            agent,
            amount,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun claim_agent_earnings(
        earnings: &mut AgentEarnings,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let agent = tx_context::sender(ctx);
        let total = agent_balance(earnings, agent);
        let already = if (table::contains(&earnings.claimed, agent)) {
            *table::borrow(&earnings.claimed, agent)
        } else {
            0
        };
        assert!(total > already, E_NOTHING_TO_CLAIM);
        let amount = total - already;
        if (table::contains(&earnings.claimed, agent)) {
            *table::borrow_mut(&mut earnings.claimed, agent) = total;
        } else {
            table::add(&mut earnings.claimed, agent, total);
        };
        let payout = coin::take(&mut earnings.balance, amount, ctx);
        event::emit(AgentEarningsClaimed {
            agent,
            amount,
            created_ms: clock::timestamp_ms(clock),
        });
        transfer::public_transfer(payout, agent);
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}
