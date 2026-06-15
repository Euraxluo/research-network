#[allow(lint(self_transfer))]
module research_protocol::delegation {
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;

    const STATUS_OPEN: u8 = 0;
    const STATUS_ACCEPTED: u8 = 1;
    const STATUS_FUNDED: u8 = 2;
    const STATUS_SUBMITTED: u8 = 3;
    const STATUS_COMPLETED: u8 = 4;
    const STATUS_REFUNDED: u8 = 5;
    const STATUS_DISPUTED: u8 = 6;
    const STATUS_RESOLVED: u8 = 7;
    const STATUS_EXPIRED: u8 = 8;

    const E_NOT_BUYER: u64 = 1;
    const E_NOT_AGENT: u64 = 2;
    const E_NOT_PARTY: u64 = 3;
    const E_WRONG_STATUS: u64 = 4;
    const E_BUDGET_MISMATCH: u64 = 5;
    const E_ZERO_BUDGET: u64 = 6;
    const E_NOT_EXPIRED: u64 = 7;
    const E_INVALID_BPS_SUM: u64 = 8;
    const E_ESCROW_EMPTY: u64 = 9;
    const E_NO_ARBITRATOR: u64 = 10;

    public struct DelegationJob has key {
        id: UID,
        buyer: address,
        agent: address,
        question_hash: vector<u8>,
        source_artifact_hash: vector<u8>,
        budget: u64,
        deadline_ms: u64,
        status: u8,
        result_report_id: Option<ID>,
        arbitrator: Option<address>,
        dispute_reason_hash: Option<vector<u8>>,
        escrow: Balance<SUI>,
        created_ms: u64,
    }

    public struct DelegationCreated has copy, drop {
        job_id: ID,
        buyer: address,
        agent: address,
        budget: u64,
        deadline_ms: u64,
        created_ms: u64,
    }

    public struct DelegationAccepted has copy, drop {
        job_id: ID,
        agent: address,
        created_ms: u64,
    }

    public struct DelegationFunded has copy, drop {
        job_id: ID,
        buyer: address,
        amount: u64,
        created_ms: u64,
    }

    public struct DelegationResultSubmitted has copy, drop {
        job_id: ID,
        report_id: ID,
        agent: address,
        created_ms: u64,
    }

    public struct DelegationCompleted has copy, drop {
        job_id: ID,
        buyer: address,
        agent: address,
        payout: u64,
        created_ms: u64,
    }

    public struct DelegationRefunded has copy, drop {
        job_id: ID,
        buyer: address,
        amount: u64,
        created_ms: u64,
    }

    public struct DelegationDisputeOpened has copy, drop {
        job_id: ID,
        opened_by: address,
        arbitrator: address,
        created_ms: u64,
    }

    public struct DelegationDisputeResolved has copy, drop {
        job_id: ID,
        arbitrator: address,
        buyer_amount: u64,
        agent_amount: u64,
        created_ms: u64,
    }

    public fun status_open(): u8 { STATUS_OPEN }
    public fun status_accepted(): u8 { STATUS_ACCEPTED }
    public fun status_funded(): u8 { STATUS_FUNDED }
    public fun status_submitted(): u8 { STATUS_SUBMITTED }
    public fun status_completed(): u8 { STATUS_COMPLETED }
    public fun status_refunded(): u8 { STATUS_REFUNDED }
    public fun status_disputed(): u8 { STATUS_DISPUTED }
    public fun status_resolved(): u8 { STATUS_RESOLVED }
    public fun status_expired(): u8 { STATUS_EXPIRED }

    public fun id(job: &DelegationJob): ID { object::id(job) }
    public fun buyer(job: &DelegationJob): address { job.buyer }
    public fun agent(job: &DelegationJob): address { job.agent }
    public fun status(job: &DelegationJob): u8 { job.status }
    public fun result_report_id(job: &DelegationJob): Option<ID> { job.result_report_id }
    public fun balance_value(job: &DelegationJob): u64 { balance::value(&job.escrow) }

    public fun can_submit(job: &DelegationJob, caller: address): bool {
        caller == job.agent &&
        (job.status == STATUS_ACCEPTED || job.status == STATUS_FUNDED)
    }

    public fun can_decrypt_private(job: &DelegationJob, caller: address): bool {
        if (caller == job.buyer || caller == job.agent) {
            true
        } else if (job.status == STATUS_DISPUTED && option::is_some(&job.arbitrator)) {
            caller == *option::borrow(&job.arbitrator)
        } else {
            false
        }
    }

    public fun create_delegation_job(
        agent: address,
        question_hash: vector<u8>,
        source_artifact_hash: vector<u8>,
        budget: u64,
        deadline_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(budget > 0, E_ZERO_BUDGET);
        let buyer = tx_context::sender(ctx);
        let created_ms = clock::timestamp_ms(clock);
        let job = DelegationJob {
            id: object::new(ctx),
            buyer,
            agent,
            question_hash,
            source_artifact_hash,
            budget,
            deadline_ms,
            status: STATUS_OPEN,
            result_report_id: option::none(),
            arbitrator: option::none(),
            dispute_reason_hash: option::none(),
            escrow: balance::zero<SUI>(),
            created_ms,
        };
        event::emit(DelegationCreated {
            job_id: object::id(&job),
            buyer,
            agent,
            budget,
            deadline_ms,
            created_ms,
        });
        transfer::share_object(job);
    }

    public fun accept_delegation_job(
        job: &mut DelegationJob,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == job.agent, E_NOT_AGENT);
        assert!(job.status == STATUS_OPEN, E_WRONG_STATUS);
        job.status = STATUS_ACCEPTED;
        event::emit(DelegationAccepted {
            job_id: object::id(job),
            agent: caller,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun fund_delegation_job(
        job: &mut DelegationJob,
        payment: Coin<SUI>,
        expected_budget: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);
        assert!(buyer == job.buyer, E_NOT_BUYER);
        assert!(job.status == STATUS_OPEN || job.status == STATUS_ACCEPTED, E_WRONG_STATUS);
        assert!(job.budget == expected_budget, E_BUDGET_MISMATCH);
        assert!(coin::value(&payment) == job.budget, E_BUDGET_MISMATCH);
        balance::join(&mut job.escrow, coin::into_balance(payment));
        job.status = STATUS_FUNDED;
        event::emit(DelegationFunded {
            job_id: object::id(job),
            buyer,
            amount: job.budget,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public(package) fun mark_submitted(
        job: &mut DelegationJob,
        report_id: ID,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(can_submit(job, caller), E_NOT_AGENT);
        job.status = STATUS_SUBMITTED;
        job.result_report_id = option::some(report_id);
        event::emit(DelegationResultSubmitted {
            job_id: object::id(job),
            report_id,
            agent: caller,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun complete_delegation_job(
        job: &mut DelegationJob,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == job.buyer, E_NOT_BUYER);
        assert!(job.status == STATUS_SUBMITTED, E_WRONG_STATUS);
        let amount = balance::value(&job.escrow);
        assert!(amount > 0, E_ESCROW_EMPTY);
        let payout = coin::take(&mut job.escrow, amount, ctx);
        job.status = STATUS_COMPLETED;
        event::emit(DelegationCompleted {
            job_id: object::id(job),
            buyer: job.buyer,
            agent: job.agent,
            payout: amount,
            created_ms: clock::timestamp_ms(clock),
        });
        transfer::public_transfer(payout, job.agent);
    }

    public fun refund_expired_delegation_job(
        job: &mut DelegationJob,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == job.buyer, E_NOT_BUYER);
        assert!(job.status == STATUS_OPEN || job.status == STATUS_ACCEPTED || job.status == STATUS_FUNDED, E_WRONG_STATUS);
        assert!(clock::timestamp_ms(clock) > job.deadline_ms, E_NOT_EXPIRED);
        let amount = balance::value(&job.escrow);
        job.status = if (amount > 0) { STATUS_REFUNDED } else { STATUS_EXPIRED };
        event::emit(DelegationRefunded {
            job_id: object::id(job),
            buyer: job.buyer,
            amount,
            created_ms: clock::timestamp_ms(clock),
        });
        if (amount > 0) {
            let refund = coin::take(&mut job.escrow, amount, ctx);
            transfer::public_transfer(refund, job.buyer);
        }
    }

    public fun open_dispute(
        job: &mut DelegationJob,
        arbitrator: address,
        reason_hash: vector<u8>,
        clock: &Clock,
        ctx: &TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(caller == job.buyer || caller == job.agent, E_NOT_PARTY);
        assert!(job.status == STATUS_SUBMITTED || job.status == STATUS_FUNDED, E_WRONG_STATUS);
        job.status = STATUS_DISPUTED;
        job.arbitrator = option::some(arbitrator);
        job.dispute_reason_hash = option::some(reason_hash);
        event::emit(DelegationDisputeOpened {
            job_id: object::id(job),
            opened_by: caller,
            arbitrator,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun resolve_dispute(
        job: &mut DelegationJob,
        buyer_bps: u64,
        agent_bps: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let caller = tx_context::sender(ctx);
        assert!(job.status == STATUS_DISPUTED, E_WRONG_STATUS);
        assert!(option::is_some(&job.arbitrator), E_NO_ARBITRATOR);
        assert!(caller == *option::borrow(&job.arbitrator), E_NO_ARBITRATOR);
        assert!(buyer_bps + agent_bps == 10000, E_INVALID_BPS_SUM);
        let amount = balance::value(&job.escrow);
        let buyer_amount = (((amount as u128) * (buyer_bps as u128)) / 10000) as u64;
        let agent_amount = amount - buyer_amount;
        job.status = STATUS_RESOLVED;
        job.arbitrator = option::none();
        event::emit(DelegationDisputeResolved {
            job_id: object::id(job),
            arbitrator: caller,
            buyer_amount,
            agent_amount,
            created_ms: clock::timestamp_ms(clock),
        });
        if (buyer_amount > 0) {
            let buyer_coin = coin::take(&mut job.escrow, buyer_amount, ctx);
            transfer::public_transfer(buyer_coin, job.buyer);
        };
        if (agent_amount > 0) {
            let agent_coin = coin::take(&mut job.escrow, agent_amount, ctx);
            transfer::public_transfer(agent_coin, job.agent);
        }
    }
}
