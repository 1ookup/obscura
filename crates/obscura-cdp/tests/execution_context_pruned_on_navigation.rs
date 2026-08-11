// Regression for issue #407: `CdpContext.valid_context_ids` was insert-only,
// so `Runtime.executionContextsCleared` on navigation never pruned the old
// context ids. A `Runtime.callFunctionOn` targeting a pre-navigation context
// still ran (Chrome rejects it with "Cannot find context with specified id"),
// and the set grew by one id per navigation on a long-lived connection.

use obscura_cdp::dispatch::CdpContext;
use obscura_cdp::domains::page::emit_navigation_events;
use obscura_browser::lifecycle::WaitUntil;

fn navigate(ctx: &mut CdpContext, page_id: &str) {
    emit_navigation_events(
        ctx,
        &Some("session-1".to_string()),
        "frame-1",
        "loader-1",
        "http://127.0.0.1/page",
        page_id,
        &[],
        WaitUntil::Load,
        true,
    );
}

#[test]
fn navigation_prunes_stale_execution_context_ids() {
    let mut ctx = CdpContext::new();
    // Seed a stale id that no navigation re-creates (simulates a context from
    // a prior page state, or simply the pre-navigation main id 1).
    ctx.valid_context_ids.insert(999);

    navigate(&mut ctx, "page-1");

    // The stale id is gone after executionContextsCleared; the default world
    // (id 2) and the first isolated world (id 100, counter starts at 100) remain.
    assert!(
        !ctx.valid_context_ids.contains(&999),
        "stale execution context id must be pruned on navigation"
    );
    assert!(ctx.valid_context_ids.contains(&2), "default world id 2 must be re-registered");
    assert!(
        ctx.valid_context_ids.contains(&100),
        "isolated world id 100 must be registered: {:?}",
        ctx.valid_context_ids
    );

    navigate(&mut ctx, "page-1");

    // Second navigation: the first nav's isolated id (100) is now stale, and a
    // fresh id (101) takes its place. The set must not grow across navigations.
    assert!(
        !ctx.valid_context_ids.contains(&100),
        "previous navigation's isolated context id must be pruned"
    );
    assert!(ctx.valid_context_ids.contains(&101), "fresh isolated id 101 must be registered");
    assert!(ctx.valid_context_ids.contains(&2), "default world id 2 must survive navigation");

    // Unbounded-growth check: two navigations leave exactly the default world
    // plus the current isolated world(s), not an accumulating union.
    let count_after_two_navs = ctx.valid_context_ids.len();
    navigate(&mut ctx, "page-1");
    navigate(&mut ctx, "page-1");
    assert_eq!(
        ctx.valid_context_ids.len(),
        count_after_two_navs,
        "valid_context_ids must not grow across navigations (was {count_after_two_navs}, now {})",
        ctx.valid_context_ids.len()
    );
}

// Phase 6.2: the execution-context table must shrink in lockstep with
// `valid_context_ids`, and every pruned child-frame context must surface a
// Runtime.executionContextDestroyed (with its uniqueId) plus a
// Page.frameDetached for its advertised frame, before the new document's
// events.
#[test]
fn navigation_prunes_execution_context_table_and_emits_teardown() {
    let mut ctx = CdpContext::new();
    ctx.valid_context_ids.insert(555);
    ctx.execution_contexts.insert(
        555,
        obscura_cdp::dispatch::ExecutionContextEntry {
            frame_id: "frame-page-1-1".to_string(),
            generation: 1,
            world_id: 0,
            is_default: true,
            world_name: String::new(),
            unique_id: "ctx-frame-page-1-555".to_string(),
        },
    );
    ctx.advertised_frames
        .push(("frame-page-1-1".to_string(), "2".to_string()));

    navigate(&mut ctx, "page-1");

    assert!(
        ctx.execution_contexts.is_empty(),
        "execution-context table must shrink with valid_context_ids: {:?}",
        ctx.execution_contexts.keys().collect::<Vec<_>>()
    );
    assert!(
        !ctx.valid_context_ids.contains(&555),
        "stale frame context id must be pruned"
    );
    assert!(
        ctx.advertised_frames.is_empty(),
        "detached frames must leave the advertised list"
    );

    let destroyed_idx = ctx
        .pending_events
        .iter()
        .position(|e| {
            e.method == "Runtime.executionContextDestroyed"
                && e.params["executionContextId"] == 555
                && e.params["executionContextUniqueId"] == "ctx-frame-page-1-555"
        })
        .expect("executionContextDestroyed must be emitted for the pruned frame context");
    let detached_idx = ctx
        .pending_events
        .iter()
        .position(|e| {
            e.method == "Page.frameDetached"
                && e.params["frameId"] == "frame-page-1-1"
                && e.params["reason"] == "remove"
        })
        .expect("frameDetached must be emitted for the pruned frame");
    let new_doc_idx = ctx
        .pending_events
        .iter()
        .position(|e| e.method == "Page.frameNavigated")
        .expect("main frameNavigated present");
    assert!(
        destroyed_idx < new_doc_idx && detached_idx < new_doc_idx,
        "teardown events must precede the new document's events \
         (destroyed {destroyed_idx}, detached {detached_idx}, nav {new_doc_idx})"
    );

    // Every table key must remain registered in valid_context_ids after any
    // later navigation (lockstep invariant, empty-set case).
    navigate(&mut ctx, "page-1");
    for context_id in ctx.execution_contexts.keys() {
        assert!(ctx.valid_context_ids.contains(context_id));
    }
}
