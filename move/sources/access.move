#[allow(lint(self_transfer))]
module research_protocol::access {
    use sui::clock::{Self, Clock};
    use sui::event;
    use research_protocol::delegation::{Self, DelegationJob};
    use research_protocol::report::{Self, ResearchReport};

    const RECEIPT_PLATFORM_MEMBER: u8 = 0;
    const RECEIPT_AGENT_SUBSCRIPTION: u8 = 1;

    const E_EXPIRED_PASS: u64 = 20;
    const E_WRONG_AGENT: u64 = 21;
    const E_TIER_TOO_LOW: u64 = 22;
    const E_NOT_AUTHORIZED: u64 = 23;

    public struct PlatformMembershipPass has key, store {
        id: UID,
        owner: address,
        tier: u8,
        started_ms: u64,
        expires_ms: u64,
    }

    public struct AgentSubscriptionPass has key, store {
        id: UID,
        owner: address,
        agent: address,
        tier: u8,
        started_ms: u64,
        expires_ms: u64,
    }

    public struct AccessReceipt has key, store {
        id: UID,
        period_id: u64,
        user: address,
        report_id: ID,
        agent: address,
        access_type: u8,
        created_ms: u64,
    }

    public struct PlatformMembershipPurchased has copy, drop {
        pass_id: ID,
        owner: address,
        tier: u8,
        started_ms: u64,
        expires_ms: u64,
    }

    public struct AgentSubscriptionPurchased has copy, drop {
        pass_id: ID,
        owner: address,
        agent: address,
        tier: u8,
        started_ms: u64,
        expires_ms: u64,
    }

    public struct AccessReceiptRecorded has copy, drop {
        receipt_id: ID,
        period_id: u64,
        user: address,
        report_id: ID,
        agent: address,
        access_type: u8,
        created_ms: u64,
    }

    public fun receipt_platform_member(): u8 { RECEIPT_PLATFORM_MEMBER }
    public fun receipt_agent_subscription(): u8 { RECEIPT_AGENT_SUBSCRIPTION }

    public fun platform_pass_owner(pass: &PlatformMembershipPass): address { pass.owner }
    public fun platform_pass_tier(pass: &PlatformMembershipPass): u8 { pass.tier }
    public fun platform_pass_expires_ms(pass: &PlatformMembershipPass): u64 { pass.expires_ms }
    public fun agent_pass_owner(pass: &AgentSubscriptionPass): address { pass.owner }
    public fun agent_pass_agent(pass: &AgentSubscriptionPass): address { pass.agent }
    public fun agent_pass_tier(pass: &AgentSubscriptionPass): u8 { pass.tier }
    public fun agent_pass_expires_ms(pass: &AgentSubscriptionPass): u64 { pass.expires_ms }
    public fun receipt_period_id(receipt: &AccessReceipt): u64 { receipt.period_id }
    public fun receipt_user(receipt: &AccessReceipt): address { receipt.user }
    public fun receipt_report_id(receipt: &AccessReceipt): ID { receipt.report_id }
    public fun receipt_agent(receipt: &AccessReceipt): address { receipt.agent }
    public fun receipt_access_type(receipt: &AccessReceipt): u8 { receipt.access_type }

    public(package) fun mint_platform_membership_pass(
        owner: address,
        tier: u8,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let started_ms = clock::timestamp_ms(clock);
        let pass = PlatformMembershipPass {
            id: object::new(ctx),
            owner,
            tier,
            started_ms,
            expires_ms: started_ms + duration_ms,
        };
        event::emit(PlatformMembershipPurchased {
            pass_id: object::id(&pass),
            owner,
            tier,
            started_ms,
            expires_ms: pass.expires_ms,
        });
        transfer::public_transfer(pass, owner);
    }

    public(package) fun mint_agent_subscription_pass(
        owner: address,
        agent: address,
        tier: u8,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let started_ms = clock::timestamp_ms(clock);
        let pass = AgentSubscriptionPass {
            id: object::new(ctx),
            owner,
            agent,
            tier,
            started_ms,
            expires_ms: started_ms + duration_ms,
        };
        event::emit(AgentSubscriptionPurchased {
            pass_id: object::id(&pass),
            owner,
            agent,
            tier,
            started_ms,
            expires_ms: pass.expires_ms,
        });
        transfer::public_transfer(pass, owner);
    }

    fun platform_pass_valid(pass: &PlatformMembershipPass, report: &ResearchReport, caller: address, clock: &Clock): bool {
        pass.owner == caller &&
        clock::timestamp_ms(clock) <= pass.expires_ms &&
        pass.tier >= report::required_tier(report)
    }

    fun agent_pass_valid(pass: &AgentSubscriptionPass, report: &ResearchReport, caller: address, clock: &Clock): bool {
        pass.owner == caller &&
        pass.agent == report::agent(report) &&
        clock::timestamp_ms(clock) <= pass.expires_ms &&
        pass.tier >= report::required_tier(report)
    }

    public fun assert_platform_membership_access(
        pass: &PlatformMembershipPass,
        report: &ResearchReport,
        clock: &Clock,
        ctx: &TxContext
    ) {
        assert!(platform_pass_valid(pass, report, tx_context::sender(ctx), clock), E_NOT_AUTHORIZED);
    }

    public fun assert_agent_subscription_access(
        pass: &AgentSubscriptionPass,
        report: &ResearchReport,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(pass.owner == caller, E_NOT_AUTHORIZED);
        assert!(pass.agent == report::agent(report), E_WRONG_AGENT);
        assert!(clock::timestamp_ms(clock) <= pass.expires_ms, E_EXPIRED_PASS);
        assert!(pass.tier >= report::required_tier(report), E_TIER_TOO_LOW);
    }

    /// Seal access policy for the report's own author/agent. The publisher can
    /// always decrypt their own report — used for the publish→self-decrypt
    /// bootstrap and for the author re-reading their work. Requires only the
    /// report object + clock (no pass), so no type-mismatch abort on the PTB.
    public fun seal_approve_report_author(
        id: vector<u8>,
        report: &ResearchReport,
        ctx: &TxContext
    ) {
        assert!(id == report::seal_id(report), E_NOT_AUTHORIZED);
        assert!(tx_context::sender(ctx) == report::agent(report), E_NOT_AUTHORIZED);
    }

    /// Seal access policy for encrypted reports gated by platform membership.
    ///
    /// Per SUI_Seal_SKILL.md §4.2 the Seal key-server contract requires:
    ///   - first parameter is the identity `id: vector<u8>` (no package prefix);
    ///   - the function is side-effect-free and deterministic;
    ///   - access denial is expressed by `assert!`/abort, not by a return value.
    ///
    /// The Seal identity is the `seal_id` field chosen by the publisher at
    /// publish time (a deterministic 32-byte value). At encrypt time the
    /// publisher encrypts under this same `seal_id`; the ciphertext embeds it,
    /// and here we assert the PTB id matches the stored field. This avoids the
    /// chicken-and-egg of using the report object id (unknown until publish).
    public fun seal_approve_report_with_platform_membership(
        id: vector<u8>,
        report: &ResearchReport,
        pass: &PlatformMembershipPass,
        clock: &Clock,
        ctx: &TxContext
    ) {
        assert!(id == report::seal_id(report), E_NOT_AUTHORIZED);
        let caller = tx_context::sender(ctx);
        let allowed = caller == report::agent(report) ||
            (report::visibility(report) == report::visibility_encrypted() &&
                platform_pass_valid(pass, report, caller, clock));
        assert!(allowed, E_NOT_AUTHORIZED);
    }

    /// Seal access policy for encrypted reports gated by an agent subscription.
    public fun seal_approve_report_with_agent_subscription(
        id: vector<u8>,
        report: &ResearchReport,
        pass: &AgentSubscriptionPass,
        clock: &Clock,
        ctx: &TxContext
    ) {
        assert!(id == report::seal_id(report), E_NOT_AUTHORIZED);
        let caller = tx_context::sender(ctx);
        let allowed = caller == report::agent(report) ||
            (report::visibility(report) == report::visibility_encrypted() &&
                agent_pass_valid(pass, report, caller, clock));
        assert!(allowed, E_NOT_AUTHORIZED);
    }

    /// Seal access policy for private delegation results. Only the buyer and
    /// the executing agent of the linked DelegationJob can decrypt by default.
    public fun seal_approve_private_result(
        id: vector<u8>,
        report: &ResearchReport,
        job: &DelegationJob,
        ctx: &TxContext
    ) {
        assert!(id == report::seal_id(report), E_NOT_AUTHORIZED);
        let linked = report::visibility(report) == report::visibility_private_delegation() &&
            option::is_some(&report::delegation_job_id(report)) &&
            *option::borrow(&report::delegation_job_id(report)) == delegation::id(job);
        assert!(linked, E_NOT_AUTHORIZED);
        assert!(delegation::can_decrypt_private(job, tx_context::sender(ctx)), E_NOT_AUTHORIZED);
    }

    public(package) fun record_access_receipt(
        period_id: u64,
        user: address,
        report: &ResearchReport,
        access_type: u8,
        clock: &Clock,
        ctx: &mut TxContext
    ): AccessReceipt {
        let receipt = AccessReceipt {
            id: object::new(ctx),
            period_id,
            user,
            report_id: report::id(report),
            agent: report::agent(report),
            access_type,
            created_ms: clock::timestamp_ms(clock),
        };
        event::emit(AccessReceiptRecorded {
            receipt_id: object::id(&receipt),
            period_id,
            user,
            report_id: receipt.report_id,
            agent: receipt.agent,
            access_type,
            created_ms: receipt.created_ms,
        });
        receipt
    }
}
