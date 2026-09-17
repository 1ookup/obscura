//! Browser-core browsing-context (frame) registry.
//!
//! The registry is the single source of truth for the page's frame tree
//! (docs/Iframe-support-design.md, Phase 1.7). CDP's frame model is a
//! projection of this registry, not a second bookkeeping layer. A frame id
//! stays stable across navigations of that frame; the active document root,
//! document generation and loader id are replaced on every committed
//! cross-document navigation.

use std::collections::HashMap;

use obscura_dom::NodeId;

/// One browsing context. The JS-side WindowProxy (Phase 2) keys off
/// `frame_id` and survives document replacement; it is intentionally not
/// stored here because it lives in the V8 runtime.
#[derive(Clone, Debug)]
pub struct BrowsingContext {
    pub frame_id: String,
    /// `None` for the main frame.
    pub parent_frame_id: Option<String>,
    /// Host `<iframe>` NodeId in the shared DomTree; `None` for the main
    /// frame.
    pub host_nid: Option<NodeId>,
    /// Content-document root of the active document, `None` before the
    /// initial about:blank document is created (main frame: the DomTree's
    /// document node is implicit and this stays `None`).
    pub active_document_root: Option<NodeId>,
    /// Increments on every committed cross-document navigation.
    pub document_generation: u64,
    /// Increments when a navigation *starts*. Async fetch/parse/script work
    /// carries the value it started with and may commit only while it is
    /// still current, so a slow response for an old `src` cannot overwrite a
    /// newer navigation.
    pub navigation_generation: u64,
    /// CDP loader id for the active document.
    pub loader_id: String,
    /// Navigation timing for the active document, installed into its Window
    /// realm before preload and author scripts run.
    pub navigation_timing: Option<serde_json::Value>,
    /// Unix-epoch milliseconds of the navigation's network start. Chrome
    /// anchors a frame realm's Performance clock to navigation start, not to
    /// realm creation, so `performance.now()` right after the document loads
    /// already includes the full network elapsed time.
    pub navigation_start_ms: Option<f64>,
    /// Child frame ids in creation order.
    pub children: Vec<String>,
}

/// Frame registry for one page. The main frame is created on construction
/// and cannot be detached.
#[derive(Debug)]
pub struct FrameRegistry {
    frames: HashMap<String, BrowsingContext>,
    by_host: HashMap<NodeId, String>,
    main_frame_id: String,
    next_frame: u64,
    next_loader: u64,
}

impl FrameRegistry {
    pub fn new(main_frame_id: String) -> Self {
        let mut frames = HashMap::new();
        frames.insert(
            main_frame_id.clone(),
            BrowsingContext {
                frame_id: main_frame_id.clone(),
                parent_frame_id: None,
                host_nid: None,
                active_document_root: None,
                document_generation: 0,
                navigation_generation: 0,
                loader_id: "1".to_string(),
                navigation_timing: None,
                navigation_start_ms: None,
                children: Vec::new(),
            },
        );
        FrameRegistry {
            frames,
            by_host: HashMap::new(),
            main_frame_id,
            next_frame: 0,
            next_loader: 1,
        }
    }

    pub fn main_frame_id(&self) -> &str {
        &self.main_frame_id
    }

    pub fn get(&self, frame_id: &str) -> Option<&BrowsingContext> {
        self.frames.get(frame_id)
    }

    pub fn get_mut(&mut self, frame_id: &str) -> Option<&mut BrowsingContext> {
        self.frames.get_mut(frame_id)
    }

    pub fn by_host(&self, host_nid: NodeId) -> Option<&BrowsingContext> {
        self.by_host
            .get(&host_nid)
            .and_then(|id| self.frames.get(id))
    }

    pub fn frame_ids(&self) -> impl Iterator<Item = &str> {
        self.frames.keys().map(String::as_str)
    }

    /// Number of ancestors between `frame_id` and the main frame. Used by the
    /// loader's recursion guard (Phase 3.5).
    pub fn depth(&self, frame_id: &str) -> usize {
        let mut depth = 0;
        let mut current = self.frames.get(frame_id);
        // The parent chain cannot be longer than the registry; bound the walk
        // so a corrupt registry cannot spin.
        for _ in 0..self.frames.len() {
            match current.and_then(|frame| frame.parent_frame_id.as_deref()) {
                Some(parent) => {
                    depth += 1;
                    current = self.frames.get(parent);
                }
                None => break,
            }
        }
        depth
    }

    /// Register a child browsing context hosted by `host_nid`. Frame ids
    /// follow the `frame-<page>-<n>` convention so they are unique per page
    /// and recognizably distinct from the main frame id (which equals the
    /// target id, a Chromium convention Playwright depends on).
    pub fn attach_child(&mut self, parent_frame_id: &str, host_nid: NodeId) -> Option<String> {
        if !self.frames.contains_key(parent_frame_id) {
            return None;
        }
        {
            static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
            if *ON.get_or_init(|| std::env::var_os("OBSCURA_DEBUG_FRAMES").is_some()) {
                eprintln!(
                    "[frame-attach] parent={parent_frame_id} host={} already={:?}",
                    host_nid.raw(),
                    self.by_host.get(&host_nid).map(String::as_str)
                );
            }
        }
        self.next_frame += 1;
        let frame_id = format!("frame-{}-{}", self.main_frame_id, self.next_frame);
        let loader_id = self.allocate_loader_id();
        self.frames.insert(
            frame_id.clone(),
            BrowsingContext {
                frame_id: frame_id.clone(),
                parent_frame_id: Some(parent_frame_id.to_string()),
                host_nid: Some(host_nid),
                active_document_root: None,
                document_generation: 0,
                navigation_generation: 0,
                loader_id,
                navigation_timing: None,
                navigation_start_ms: None,
                children: Vec::new(),
            },
        );
        self.by_host.insert(host_nid, frame_id.clone());
        if let Some(parent) = self.frames.get_mut(parent_frame_id) {
            parent.children.push(frame_id.clone());
        }
        Some(frame_id)
    }

    /// Start a navigation: bump and return the frame's navigation
    /// generation. Any in-flight work holding an older generation is
    /// superseded and must not commit.
    pub fn begin_navigation(&mut self, frame_id: &str) -> Option<u64> {
        let frame = self.frames.get_mut(frame_id)?;
        frame.navigation_generation += 1;
        Some(frame.navigation_generation)
    }

    /// Whether work started under `navigation_generation` may still commit.
    pub fn navigation_is_current(&self, frame_id: &str, navigation_generation: u64) -> bool {
        self.frames
            .get(frame_id)
            .is_some_and(|frame| frame.navigation_generation == navigation_generation)
    }

    /// Commit a new document for the frame: replace the active root, bump the
    /// document generation and allocate a fresh loader id. Returns the
    /// superseded document root, whose realms and registries the caller
    /// destroys (Phase 1.3). Refuses stale commits.
    pub fn commit_document(
        &mut self,
        frame_id: &str,
        navigation_generation: u64,
        new_root: Option<NodeId>,
    ) -> Result<CommittedDocument, CommitError> {
        let loader_id = self.allocate_loader_id();
        let frame = self
            .frames
            .get_mut(frame_id)
            .ok_or(CommitError::UnknownFrame)?;
        if frame.navigation_generation != navigation_generation {
            return Err(CommitError::Superseded);
        }
        let previous_root = std::mem::replace(&mut frame.active_document_root, new_root);
        frame.document_generation += 1;
        frame.loader_id = loader_id.clone();
        Ok(CommittedDocument {
            document_generation: frame.document_generation,
            loader_id,
            previous_root,
        })
    }

    /// Detach a frame and all its descendants, returning the removed
    /// contexts (deepest first, so callers can tear down child state before
    /// parents). The main frame cannot be detached. Removal invalidates the
    /// navigation generation before the caller detaches the subtree, so
    /// in-flight loads for removed frames cannot commit.
    pub fn detach(&mut self, frame_id: &str) -> Vec<BrowsingContext> {
        if frame_id == self.main_frame_id {
            return Vec::new();
        }
        let Some(frame) = self.frames.get(frame_id) else {
            return Vec::new();
        };
        let parent = frame.parent_frame_id.clone();

        // Collect the subtree in preorder, then remove deepest-first.
        let mut order = Vec::new();
        let mut stack = vec![frame_id.to_string()];
        while let Some(id) = stack.pop() {
            if let Some(frame) = self.frames.get(&id) {
                stack.extend(frame.children.iter().cloned());
                order.push(id);
            }
        }
        let mut removed = Vec::new();
        for id in order.into_iter().rev() {
            if let Some(mut frame) = self.frames.remove(&id) {
                frame.navigation_generation += 1;
                if let Some(host) = frame.host_nid {
                    if self.by_host.get(&host) == Some(&id) {
                        self.by_host.remove(&host);
                    }
                }
                removed.push(frame);
            }
        }
        if let Some(parent) = parent.and_then(|id| self.frames.get_mut(&id)) {
            parent.children.retain(|child| child != frame_id);
        }
        removed
    }

    fn allocate_loader_id(&mut self) -> String {
        self.next_loader += 1;
        self.next_loader.to_string()
    }
}

#[derive(Clone, Debug)]
pub struct CommittedDocument {
    pub document_generation: u64,
    pub loader_id: String,
    pub previous_root: Option<NodeId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitError {
    UnknownFrame,
    /// A newer navigation started after this one; the commit is dropped.
    Superseded,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_frames_attach_navigate_and_detach_deepest_first() {
        let mut frames = FrameRegistry::new("page-1".to_string());
        let host_a = NodeId::new(10);
        let host_b = NodeId::new(20);
        let a = frames.attach_child("page-1", host_a).unwrap();
        let b = frames.attach_child(&a, host_b).unwrap();
        assert_eq!(frames.get(&a).unwrap().parent_frame_id.as_deref(), Some("page-1"));
        assert_eq!(frames.get("page-1").unwrap().children, vec![a.clone()]);
        assert_eq!(frames.by_host(host_b).unwrap().frame_id, b);
        assert_eq!(frames.depth(&b), 2);

        let nav = frames.begin_navigation(&a).unwrap();
        let commit = frames
            .commit_document(&a, nav, Some(NodeId::new(30)))
            .unwrap();
        assert_eq!(commit.document_generation, 1);
        assert_eq!(commit.previous_root, None);

        let removed = frames.detach(&a);
        let removed_ids: Vec<_> = removed.iter().map(|f| f.frame_id.clone()).collect();
        assert_eq!(removed_ids, vec![b.clone(), a.clone()]);
        assert!(frames.get(&a).is_none());
        assert!(frames.by_host(host_a).is_none());
        assert!(frames.get("page-1").unwrap().children.is_empty());
    }

    #[test]
    fn stale_navigation_cannot_commit() {
        let mut frames = FrameRegistry::new("page-1".to_string());
        let child = frames.attach_child("page-1", NodeId::new(5)).unwrap();
        // Slow navigation A starts, then B starts: A's commit is refused, B's
        // is accepted. This is the slow-A/fast-B regression shape from the
        // design doc's risk table.
        let nav_a = frames.begin_navigation(&child).unwrap();
        let nav_b = frames.begin_navigation(&child).unwrap();
        assert_eq!(
            frames
                .commit_document(&child, nav_a, Some(NodeId::new(6)))
                .unwrap_err(),
            CommitError::Superseded
        );
        let committed = frames
            .commit_document(&child, nav_b, Some(NodeId::new(7)))
            .unwrap();
        assert_eq!(committed.document_generation, 1);
        assert!(frames.navigation_is_current(&child, nav_b));
        assert!(!frames.navigation_is_current(&child, nav_a));

        // Detaching invalidates the generation, so an in-flight load of a
        // removed frame cannot commit either.
        let removed = frames.detach(&child);
        assert_eq!(removed.len(), 1);
        assert!(!frames.navigation_is_current(&child, nav_b));
    }

    #[test]
    fn main_frame_cannot_be_detached() {
        let mut frames = FrameRegistry::new("page-1".to_string());
        assert!(frames.detach("page-1").is_empty());
        assert!(frames.get("page-1").is_some());
    }
}
