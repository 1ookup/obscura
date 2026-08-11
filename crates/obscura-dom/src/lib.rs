#[macro_use]
extern crate html5ever;

pub mod tree;
pub mod tree_sink;
pub mod selector;
pub mod serialize;

pub use tree::{
    AttachIframeError, AttachShadowError, Attribute, DocumentScope, DomTree, Node, NodeData,
    NodeId, OpaqueOriginId, Origin, SandboxFlags, ShadowRoot, ShadowRootMode,
};
pub use tree_sink::{parse_fragment, parse_fragment_with_context, parse_html, parse_into_subtree};
