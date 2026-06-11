module research_protocol::license {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::option::Option;

    public struct SkillLicense has key, store {
        id: UID,
        skill_id: ID,
        owner: address,
        license_type: u8,
        issued_ms: u64,
        expires_ms: Option<u64>,
        commercial: bool,
        agent_allowed: bool,
        seats: u64,
    }

    public struct LicensePurchased has copy, drop {
        license_id: ID,
        skill_id: ID,
        buyer: address,
        license_type: u8,
        issued_ms: u64,
        expires_ms: Option<u64>,
    }

    entry fun mint_license(
        skill_id: ID,
        license_type: u8,
        expires_ms: Option<u64>,
        commercial: bool,
        agent_allowed: bool,
        seats: u64,
        issued_ms: u64,
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);
        let lic = SkillLicense {
            id: object::new(ctx),
            skill_id,
            owner: buyer,
            license_type,
            issued_ms,
            expires_ms,
            commercial,
            agent_allowed,
            seats,
        };
        let license_id = object::id(&lic);
        event::emit(LicensePurchased {
            license_id,
            skill_id,
            buyer,
            license_type,
            issued_ms,
            expires_ms,
        });
        sui::transfer::public_transfer(lic, buyer);
    }
}
