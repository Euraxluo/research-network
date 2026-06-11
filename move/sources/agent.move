module research_protocol::agent {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;

    public struct AgentPassport has key, store {
        id: UID,
        owner: address,
        name_hash: vector<u8>,
        github_hash: vector<u8>,
        scopes_hash: vector<u8>,
        created_ms: u64,
    }

    public struct AgentPassportCreated has copy, drop {
        passport_id: ID,
        owner: address,
        name_hash: vector<u8>,
        github_hash: vector<u8>,
        scopes_hash: vector<u8>,
        created_ms: u64,
    }

    entry fun create_passport(
        name_hash: vector<u8>,
        github_hash: vector<u8>,
        scopes_hash: vector<u8>,
        created_ms: u64,
        ctx: &mut TxContext
    ) {
        let owner = tx_context::sender(ctx);
        let passport = AgentPassport {
            id: object::new(ctx),
            owner,
            name_hash,
            github_hash,
            scopes_hash,
            created_ms,
        };
        let passport_id = object::id(&passport);
        event::emit(AgentPassportCreated {
            passport_id,
            owner,
            name_hash: passport.name_hash,
            github_hash: passport.github_hash,
            scopes_hash: passport.scopes_hash,
            created_ms,
        });
        sui::transfer::public_transfer(passport, owner);
    }
}
