module research_protocol::reputation {
    use sui::event;
    use sui::clock::{Self, Clock};

    public struct Reputation has key {
        id: UID,
        owner: address,
        score: u64,
        created_ms: u64,
        updated_ms: u64,
    }

    public struct ReputationCreated has copy, drop {
        reputation_id: ID,
        owner: address,
        score: u64,
        created_ms: u64,
    }

    public struct ReputationAdjusted has copy, drop {
        reputation_id: ID,
        owner: address,
        delta: u64,
        new_score: u64,
        reason_hash: vector<u8>,
        updated_ms: u64,
    }

    public fun create_reputation(
        owner: address,
        initial_score: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let created_ms = clock::timestamp_ms(clock);
        let reputation = Reputation {
            id: object::new(ctx),
            owner,
            score: initial_score,
            created_ms,
            updated_ms: created_ms,
        };
        let reputation_id = object::id(&reputation);
        event::emit(ReputationCreated {
            reputation_id,
            owner,
            score: initial_score,
            created_ms,
        });
        transfer::transfer(reputation, owner);
    }

    public fun add_reputation(
        reputation: &mut Reputation,
        delta: u64,
        reason_hash: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        let updated_ms = clock::timestamp_ms(clock);
        reputation.score = reputation.score + delta;
        reputation.updated_ms = updated_ms;
        event::emit(ReputationAdjusted {
            reputation_id: object::id(reputation),
            owner: reputation.owner,
            delta,
            new_score: reputation.score,
            reason_hash,
            updated_ms,
        });
    }
}
