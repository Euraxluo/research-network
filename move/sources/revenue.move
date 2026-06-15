#[allow(lint(self_transfer))]
module research_protocol::revenue {
    use sui::event;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};

    const E_INVALID_BPS_SUM: u64 = 1;
    const E_RECIPIENTS_MISMATCH: u64 = 6;
    const E_NOT_RECIPIENT: u64 = 7;
    const E_NOTHING_TO_CLAIM: u64 = 12;

    /// A shared pool that escrows real Coin<SUI> and splits it among recipients by basis
    /// points. Shared (not owned) so every recipient can pull their own share.
    public struct RevenuePool has key {
        id: UID,
        asset_id: ID,
        creator: address,
        recipients: vector<address>,
        weights_bps: vector<u64>,
        /// Cumulative SUI ever deposited (monotonically increasing).
        total_received: u64,
        /// Per-recipient cumulative amount already withdrawn.
        claimed: Table<address, u64>,
        /// Escrowed, not-yet-claimed funds.
        balance: Balance<SUI>,
    }

    public struct RevenuePoolCreated has copy, drop {
        pool_id: ID,
        asset_id: ID,
    }

    public struct RevenueDeposited has copy, drop {
        pool_id: ID,
        from: address,
        amount: u64,
        total_received: u64,
        created_ms: u64,
    }

    public struct RevenueClaimed has copy, drop {
        pool_id: ID,
        claimer: address,
        amount: u64,
        created_ms: u64,
    }

    public fun assert_bps_sum(weights: &vector<u64>) {
        let mut i = 0;
        let mut sum = 0;
        while (i < vector::length(weights)) {
            sum = sum + *vector::borrow(weights, i);
            i = i + 1;
        };
        assert!(sum == 10000, E_INVALID_BPS_SUM);
    }

    public fun pool_id(pool: &RevenuePool): ID { object::id(pool) }
    public fun total_received(pool: &RevenuePool): u64 { pool.total_received }
    public fun balance_value(pool: &RevenuePool): u64 { balance::value(&pool.balance) }

    public fun claimed_by(pool: &RevenuePool, who: address): u64 {
        if (table::contains(&pool.claimed, who)) {
            *table::borrow(&pool.claimed, who)
        } else {
            0
        }
    }

    public fun create_revenue_pool(
        asset_id: ID,
        recipients: vector<address>,
        weights_bps: vector<u64>,
        ctx: &mut TxContext
    ) {
        assert!(vector::length(&recipients) == vector::length(&weights_bps), E_RECIPIENTS_MISMATCH);
        assert_bps_sum(&weights_bps);
        let pool = RevenuePool {
            id: object::new(ctx),
            asset_id,
            creator: tx_context::sender(ctx),
            recipients,
            weights_bps,
            total_received: 0,
            claimed: table::new(ctx),
            balance: balance::zero<SUI>(),
        };
        event::emit(RevenuePoolCreated { pool_id: object::id(&pool), asset_id });
        transfer::share_object(pool);
    }

    /// Deposit real funds into the pool. Callable by any module/account after it validates
    /// the business rule. Increases `total_received` so recipients become entitled to a share.
    public fun deposit(
        pool: &mut RevenuePool,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let amount = coin::value(&payment);
        balance::join(&mut pool.balance, coin::into_balance(payment));
        pool.total_received = pool.total_received + amount;
        event::emit(RevenueDeposited {
            pool_id: object::id(pool),
            from: tx_context::sender(ctx),
            amount,
            total_received: pool.total_received,
            created_ms: clock::timestamp_ms(clock),
        });
    }

    public fun deposit_revenue(
        pool: &mut RevenuePool,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        deposit(pool, payment, clock, ctx);
    }

    /// Pull the caller's pro-rata share that has accrued since their last claim.
    /// Real Coin<SUI> is transferred out. Cumulative bookkeeping in `claimed` makes
    /// repeated calls without new deposits a no-op abort (`E_NOTHING_TO_CLAIM`).
    public fun record_revenue_claim(
        pool: &mut RevenuePool,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let claimer = tx_context::sender(ctx);
        let idx = recipient_index(&pool.recipients, claimer);
        let weight = *vector::borrow(&pool.weights_bps, idx);
        let entitlement = (((pool.total_received as u128) * (weight as u128)) / 10000) as u64;
        let already = claimed_by(pool, claimer);
        assert!(entitlement > already, E_NOTHING_TO_CLAIM);
        let amount = entitlement - already;

        if (table::contains(&pool.claimed, claimer)) {
            *table::borrow_mut(&mut pool.claimed, claimer) = entitlement;
        } else {
            table::add(&mut pool.claimed, claimer, entitlement);
        };

        let payout = coin::take(&mut pool.balance, amount, ctx);
        event::emit(RevenueClaimed {
            pool_id: object::id(pool),
            claimer,
            amount,
            created_ms: clock::timestamp_ms(clock),
        });
        transfer::public_transfer(payout, claimer);
    }

    fun recipient_index(recipients: &vector<address>, who: address): u64 {
        let mut i = 0;
        let n = vector::length(recipients);
        while (i < n) {
            if (*vector::borrow(recipients, i) == who) {
                return i
            };
            i = i + 1;
        };
        abort E_NOT_RECIPIENT
    }
}
