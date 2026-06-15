#[allow(lint(self_transfer))]
module research_protocol::report {
    use sui::clock::{Self, Clock};
    use sui::event;
    use research_protocol::delegation::{Self, DelegationJob};

    const VISIBILITY_PUBLIC: u8 = 0;
    const VISIBILITY_ENCRYPTED: u8 = 1;
    const VISIBILITY_PRIVATE_DELEGATION: u8 = 2;

    const E_NOT_AGENT: u64 = 2;
    const E_EMPTY_SEAL_ID: u64 = 11;
    const E_PRIVATE_SUBMIT_NOT_ALLOWED: u64 = 12;

    public struct ResearchReport has key, store {
        id: UID,
        agent: address,
        visibility: u8,
        required_tier: u8,
        walrus_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ciphertext_hash: vector<u8>,
        plaintext_commitment: vector<u8>,
        free_preview_hash: vector<u8>,
        delegation_job_id: Option<ID>,
        created_ms: u64,
    }

    public struct ResearchReportPublished has copy, drop {
        report_id: ID,
        agent: address,
        visibility: u8,
        required_tier: u8,
        walrus_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ciphertext_hash: vector<u8>,
        plaintext_commitment: vector<u8>,
        free_preview_hash: vector<u8>,
        delegation_job_id: Option<ID>,
        created_ms: u64,
    }

    public fun visibility_public(): u8 { VISIBILITY_PUBLIC }
    public fun visibility_encrypted(): u8 { VISIBILITY_ENCRYPTED }
    public fun visibility_private_delegation(): u8 { VISIBILITY_PRIVATE_DELEGATION }

    public fun id(report: &ResearchReport): ID { object::id(report) }
    public fun agent(report: &ResearchReport): address { report.agent }
    public fun visibility(report: &ResearchReport): u8 { report.visibility }
    public fun required_tier(report: &ResearchReport): u8 { report.required_tier }
    public fun seal_id(report: &ResearchReport): vector<u8> { report.seal_id }
    public fun delegation_job_id(report: &ResearchReport): Option<ID> { report.delegation_job_id }

    fun assert_sealed(seal_id: &vector<u8>) {
        assert!(vector::length(seal_id) > 0, E_EMPTY_SEAL_ID);
    }

    fun emit_published(report: &ResearchReport) {
        event::emit(ResearchReportPublished {
            report_id: object::id(report),
            agent: report.agent,
            visibility: report.visibility,
            required_tier: report.required_tier,
            walrus_blob_id: report.walrus_blob_id,
            seal_id: report.seal_id,
            ciphertext_hash: report.ciphertext_hash,
            plaintext_commitment: report.plaintext_commitment,
            free_preview_hash: report.free_preview_hash,
            delegation_job_id: report.delegation_job_id,
            created_ms: report.created_ms,
        });
    }

    public fun publish_public_report(
        walrus_blob_id: vector<u8>,
        plaintext_commitment: vector<u8>,
        free_preview_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let agent = tx_context::sender(ctx);
        let report = ResearchReport {
            id: object::new(ctx),
            agent,
            visibility: VISIBILITY_PUBLIC,
            required_tier: 0,
            walrus_blob_id,
            seal_id: vector[],
            ciphertext_hash: vector[],
            plaintext_commitment,
            free_preview_hash,
            delegation_job_id: option::none(),
            created_ms: clock::timestamp_ms(clock),
        };
        emit_published(&report);
        transfer::public_transfer(report, agent);
    }

    public fun publish_encrypted_report(
        walrus_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ciphertext_hash: vector<u8>,
        plaintext_commitment: vector<u8>,
        free_preview_hash: vector<u8>,
        required_tier: u8,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert_sealed(&seal_id);
        let agent = tx_context::sender(ctx);
        let report = ResearchReport {
            id: object::new(ctx),
            agent,
            visibility: VISIBILITY_ENCRYPTED,
            required_tier,
            walrus_blob_id,
            seal_id,
            ciphertext_hash,
            plaintext_commitment,
            free_preview_hash,
            delegation_job_id: option::none(),
            created_ms: clock::timestamp_ms(clock),
        };
        emit_published(&report);
        transfer::public_transfer(report, agent);
    }

    public fun publish_private_result(
        job: &mut DelegationJob,
        walrus_blob_id: vector<u8>,
        seal_id: vector<u8>,
        ciphertext_hash: vector<u8>,
        plaintext_commitment: vector<u8>,
        free_preview_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert_sealed(&seal_id);
        let agent = tx_context::sender(ctx);
        assert!(agent == delegation::agent(job), E_NOT_AGENT);
        assert!(delegation::can_submit(job, agent), E_PRIVATE_SUBMIT_NOT_ALLOWED);
        let report = ResearchReport {
            id: object::new(ctx),
            agent,
            visibility: VISIBILITY_PRIVATE_DELEGATION,
            required_tier: 0,
            walrus_blob_id,
            seal_id,
            ciphertext_hash,
            plaintext_commitment,
            free_preview_hash,
            delegation_job_id: option::some(delegation::id(job)),
            created_ms: clock::timestamp_ms(clock),
        };
        let report_id = object::id(&report);
        delegation::mark_submitted(job, report_id, clock, ctx);
        emit_published(&report);
        transfer::public_transfer(report, agent);
    }
}
