use crate::tree::{DomTree, NodeData, NodeId};

// A unit of pending serialization work. Held on an explicit heap stack instead
// of the call stack so a deeply nested tree cannot overflow the thread stack and
// abort the process (a stack overflow is a hard abort that `op_dom`'s
// catch_unwind cannot recover). `descendants()` is iterative + capped for the
// same reason; the serializer must be too.
enum SerializeWork {
    // Serialize this node; `include_self` mirrors the old recursive param.
    Node(NodeId, bool),
    // Emit a previously-opened element's closing tag, after its children.
    CloseTag(String),
}

impl DomTree {
    pub fn outer_html(&self, node_id: NodeId) -> String {
        let mut buf = String::new();
        self.serialize_worklist(vec![SerializeWork::Node(node_id, true)], &mut buf);
        buf
    }

    pub fn inner_html(&self, node_id: NodeId) -> String {
        let mut buf = String::new();
        self.serialize_worklist(self.child_work(self.content_source(node_id)), &mut buf);
        buf
    }

    // The node whose children represent `node_id`'s markup. For a <template>
    // that is its contents document, since the parser puts template children
    // there rather than under the element (issue #463); for everything else it
    // is the node itself.
    fn content_source(&self, node_id: NodeId) -> NodeId {
        self.with_node(node_id, |n| match &n.data {
            NodeData::Element { template_contents: Some(contents), .. } => Some(*contents),
            _ => None,
        })
        .flatten()
        .unwrap_or(node_id)
    }

    // Children as work items in document order (top of the LIFO stack first).
    fn child_work(&self, node_id: NodeId) -> Vec<SerializeWork> {
        self.children(node_id)
            .into_iter()
            .rev()
            .map(|c| SerializeWork::Node(c, true))
            .collect()
    }

    fn serialize_worklist(&self, mut stack: Vec<SerializeWork>, buf: &mut String) {
        // Defense in depth, mirroring descendants(): a well-formed subtree emits
        // at most one Node plus one CloseTag per node, so 2*nodes.len() work
        // items bound a valid walk. Exceeding it means the graph is cyclic (the
        // append_child / insert_before guards prevent that); stop rather than
        // spin forever. On a valid tree this bound is never reached.
        let max_steps = self
            .node_slot_count()
            .saturating_mul(2)
            .saturating_add(16);
        let mut steps = 0usize;

        while let Some(work) = stack.pop() {
            steps += 1;
            if steps > max_steps {
                eprintln!("obscura: serialize worklist cap hit - tree has a cycle");
                break;
            }

            let (node_id, include_self) = match work {
                SerializeWork::CloseTag(tag) => {
                    buf.push_str("</");
                    buf.push_str(&tag);
                    buf.push('>');
                    continue;
                }
                SerializeWork::Node(node_id, include_self) => (node_id, include_self),
            };

            let node = match self.get_node(node_id) {
                Some(n) => n,
                None => continue,
            };

            match &node.data {
                NodeData::Document => {
                    for w in self.child_work(node_id) {
                        stack.push(w);
                    }
                }
                NodeData::Doctype { name, .. } => {
                    buf.push_str("<!DOCTYPE ");
                    buf.push_str(name);
                    buf.push('>');
                }
                NodeData::Element { name, attrs, template_contents, .. } => {
                    let tag = name.local.as_ref();
                    if include_self {
                        buf.push('<');
                        buf.push_str(tag);
                        for attr in attrs {
                            buf.push(' ');
                            if let Some(prefix) = &attr.name.prefix {
                                buf.push_str(prefix);
                                buf.push(':');
                            }
                            buf.push_str(attr.name.local.as_ref());
                            buf.push_str("=\"");
                            escape_attr(&attr.value, buf);
                            buf.push('"');
                        }
                        buf.push('>');
                    }

                    if !is_void_element(tag) {
                        // Push the closing tag first so it pops after all the
                        // children we push next.
                        if include_self {
                            stack.push(SerializeWork::CloseTag(tag.to_string()));
                        }
                        // A <template> serializes its contents document, not its
                        // own (always empty) children (issue #463). template_contents
                        // is already in hand from this node, so read it directly
                        // rather than re-fetching and cloning the node.
                        let source = template_contents.unwrap_or(node_id);
                        for w in self.child_work(source) {
                            stack.push(w);
                        }
                    }
                }
                NodeData::Text { contents } => {
                    let parent_is_raw = node.parent
                        .and_then(|pid| {
                            self.with_node(pid, |p| {
                                p.as_element()
                                    .map(|name| is_raw_text_element(name.local.as_ref()))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false);

                    if parent_is_raw {
                        buf.push_str(contents);
                    } else {
                        escape_text(contents, buf);
                    }
                }
                NodeData::Comment { contents } => {
                    buf.push_str("<!--");
                    // The HTML parser can never produce a comment that closes early,
                    // but script can via document.createComment(...). The tokenizer
                    // ends a comment on ANY of four sequences: "-->", "--!>", a
                    // leading ">", or a leading "->" (comment-start / -start-dash
                    // abrupt-close). Every one requires a ">". Emitting it verbatim
                    // would close the comment early and let the trailing text parse
                    // as live markup (mXSS). Entities are not decoded inside
                    // comments, so escaping every ">" to "&gt;" neutralizes all four
                    // forms at once and keeps the data as a single comment.
                    // (Supersedes the earlier "-->"-only guard, which left the
                    // leading-">", leading-"->", and "--!>" forms exploitable.)
                    if contents.contains('>') {
                        buf.push_str(&contents.replace('>', "&gt;"));
                    } else {
                        buf.push_str(contents);
                    }
                    buf.push_str("-->");
                }
                NodeData::ProcessingInstruction { target, data } => {
                    buf.push_str("<?");
                    buf.push_str(target);
                    buf.push(' ');
                    buf.push_str(data);
                    buf.push('>');
                }
            }
        }
    }
}

// Text-node escaping. Chrome 153 emits &amp;, &lt;, &gt; and &nbsp; (U+00A0)
// and leaves everything else, including ", verbatim -- measured with the same
// oracle probe as escape_attr. A non-breaking space is invisible in the
// serialized bytes but not to a byte-exact diff, so it is escaped here for the
// same reason it is in an attribute value.
fn escape_text(s: &str, buf: &mut String) {
    for c in s.chars() {
        match c {
            '&' => buf.push_str("&amp;"),
            '<' => buf.push_str("&lt;"),
            '>' => buf.push_str("&gt;"),
            '\u{00a0}' => buf.push_str("&nbsp;"),
            _ => buf.push(c),
        }
    }
}

// Attribute-value escaping, as Chrome 153 actually serializes (measured with
// getAttribute/setAttribute round trips through innerHTML and outerHTML on a
// local headless build; the same table comes back from a full parse of each
// entity form, so it is the serializer's rule and not a parse artifact):
//
//   &      -> &amp;
//   "      -> &quot;
//   U+00A0 -> &nbsp;
//   <      -> &lt;
//   >      -> &gt;
//
// Everything else is emitted verbatim, including ' (values are always
// double-quoted) and tab/newline (Chrome does not switch to a quoted form for
// them the way the HTML spec's attribute serialization allows). The spec's
// "escaping a string" list is only &, U+00A0 and "; Chrome also escapes the
// two markup-significant angle brackets, and an oracle diff of the Cloudflare
// challenge payload is what pinned that. Escaping all five is re-parse
// stable: each entity decodes back to the character that produced it.
fn escape_attr(s: &str, buf: &mut String) {
    for c in s.chars() {
        match c {
            '&' => buf.push_str("&amp;"),
            '"' => buf.push_str("&quot;"),
            '<' => buf.push_str("&lt;"),
            '>' => buf.push_str("&gt;"),
            '\u{00a0}' => buf.push_str("&nbsp;"),
            _ => buf.push(c),
        }
    }
}

fn is_void_element(tag: &str) -> bool {
    matches!(
        tag,
        "area" | "base" | "br" | "col" | "embed" | "hr" | "img" | "input" | "link" | "meta"
            | "param" | "source" | "track" | "wbr"
    )
}

// Text children serialized literally instead of entity-escaped. This is the
// HTML fragment-serialization "do not escape" list -- style, script, xmp,
// iframe, noembed, noframes, plaintext, plus noscript (the document is
// scripting-enabled) -- NOT the tokenizer's raw-text/RCDATA set. textarea and
// title are RCDATA when PARSED, so their text is escaped when serialized;
// listing and pre are ordinary elements on both sides. Chrome 153 answers the
// escaped form for textarea/title and the literal form for the other six, and
// the challenge's round-trip probe stores the markup only when the readback
// equals the input.
fn is_raw_text_element(tag: &str) -> bool {
    matches!(
        tag,
        "script" | "style" | "xmp" | "iframe" | "noembed" | "noframes" | "plaintext"
            | "noscript"
    )
}

#[cfg(test)]
mod tests {
    use html5ever::{LocalName, QualName};

    use crate::tree::{NodeData, ShadowRootMode};
    use crate::tree_sink::{parse_fragment_with_context, parse_html};

    // Fragment parse + serialize, the shape `div.innerHTML = x; div.innerHTML`
    // takes in the engine: the receiver element is the fragment context and
    // the result is its serialized children.
    fn inner_html_round_trip(input: &str) -> String {
        let tree = parse_html(r#"<div id="host"></div>"#);
        let host = tree.get_element_by_id("host").unwrap();
        let context = QualName::new(None, ns!(html), LocalName::from("div"));
        let fragment = parse_fragment_with_context(input, context);
        tree.import_children_from(host, &fragment, fragment.fragment_root());
        tree.inner_html(host)
    }

    #[test]
    fn test_outer_html() {
        let tree = parse_html(r#"<div id="test"><p>Hello</p></div>"#);
        let div = tree.get_element_by_id("test").unwrap();
        let html = tree.outer_html(div);
        assert!(html.contains(r#"<div id="test">"#));
        assert!(html.contains("<p>Hello</p>"));
        assert!(html.contains("</div>"));
    }

    #[test]
    fn test_inner_html() {
        let tree = parse_html(r#"<div id="test"><p>Hello</p><p>World</p></div>"#);
        let div = tree.get_element_by_id("test").unwrap();
        let html = tree.inner_html(div);
        assert!(html.contains("<p>Hello</p>"));
        assert!(html.contains("<p>World</p>"));
        assert!(!html.contains("<div"));
    }

    #[test]
    fn test_serialize_attributes() {
        let tree = parse_html(r#"<a href="https://example.com" class="link">Click</a>"#);
        let a = tree.query_selector("a").unwrap().unwrap();
        let html = tree.outer_html(a);
        assert!(html.contains("href=\"https://example.com\""));
        assert!(html.contains("class=\"link\""));
    }

    #[test]
    fn test_serialize_special_chars() {
        let tree = parse_html("<p>Hello &amp; World &lt;3</p>");
        let p = tree.query_selector("p").unwrap().unwrap();
        let html = tree.outer_html(p);
        assert!(html.contains("&amp;"));
        assert!(html.contains("&lt;"));
    }

    #[test]
    fn test_void_elements() {
        let tree = parse_html(r#"<img src="test.png"><br>"#);
        let img = tree.query_selector("img").unwrap().unwrap();
        let html = tree.outer_html(img);
        assert!(html.contains("<img"));
        assert!(!html.contains("</img>"));
    }

    #[test]
    fn comment_serialization_neutralizes_all_terminator_forms() {
        use crate::tree::NodeData;

        // A comment ends on any of "-->", "--!>", a leading ">", or a leading
        // "->". `document.createComment(...)` accepts arbitrary strings, so a
        // scripted comment can carry each closing form followed by a real tag.
        // Serializing must keep the payload inside a single comment; if it
        // closes early, the trailing "<img>" becomes live markup (mXSS).
        let payloads = [
            "><img src=x onerror=alert(1)>", // leading ">" abrupt-closes empty comment
            "-><img src=x>",                 // leading "->" abrupt-closes
            "a--!><img src=x>",              // internal "--!>" closes (incorrectly-closed)
            "a--><img src=x>",               // internal "-->" closes (the previously-fixed form)
        ];

        for payload in payloads {
            let tree = parse_html(r#"<div id="host"></div>"#);
            let host = tree.get_element_by_id("host").unwrap();
            let comment = tree.new_node(NodeData::Comment { contents: payload.to_string() });
            tree.append_child(host, comment);

            let serialized = tree.outer_html(host);

            // Re-parsing the serialized markup must not surface an <img>: the
            // payload has to stay inside the comment.
            let reparsed = parse_html(&serialized);
            assert!(
                reparsed.query_selector("img").unwrap().is_none(),
                "payload {payload:?} escaped the comment; serialized = {serialized}"
            );
            // And the serialized comment data must carry no raw ">".
            let inner = &serialized[serialized.find("<!--").unwrap() + 4..];
            let inner = &inner[..inner.find("-->").unwrap()];
            assert!(
                !inner.contains('>'),
                "comment data still contains a raw '>': {serialized}"
            );
        }
    }

    /// The Chrome 153 escaping oracle for the Cloudflare challenge payload.
    /// Every expected string below is a verbatim read of Chrome 153
    /// (`div.innerHTML = input; div.innerHTML`) on a local headless build. The
    /// rows are the ones the CF payload produced: the entities Chrome re-escapes
    /// (`<`, `>`, NBSP) sit next to the ones it does not (`'`, tab, newline), so
    /// a serializer that escapes too much fails here as loudly as one that
    /// escapes too little.
    #[test]
    fn inner_html_escaping_matches_the_chrome_153_oracle() {
        let cases = [
            ("<p>EnIF0</p><p>ikyR0</p>", "<p>EnIF0</p><p>ikyR0</p>"),
            (r#"<div data-foo="&quot;"></div>"#, r#"<div data-foo="&quot;"></div>"#),
            (r#"<div data-foo="x"></div>"#, r#"<div data-foo="x"></div>"#),
            (
                r#"<div data-foo="a&quot;b"></div>"#,
                r#"<div data-foo="a&quot;b"></div>"#,
            ),
            // Both spellings of a double quote parse to one character and
            // serialize back as &quot;.
            (r#"<div data-foo="&#34;"></div>"#, r#"<div data-foo="&quot;"></div>"#),
            ("<div data-foo='\"'></div>", r#"<div data-foo="&quot;"></div>"#),
            (r#"<div data-foo="&amp;"></div>"#, r#"<div data-foo="&amp;"></div>"#),
            (r#"<div data-foo="&lt;"></div>"#, r#"<div data-foo="&lt;"></div>"#),
            (r#"<div data-foo="&gt;"></div>"#, r#"<div data-foo="&gt;"></div>"#),
            (
                r#"<div data-foo="&nbsp;"></div>"#,
                r#"<div data-foo="&nbsp;"></div>"#,
            ),
            (r#"<img alt="&quot;">"#, r#"<img alt="&quot;">"#),
            (r#"<a href="?a=&quot;b">z</a>"#, r#"<a href="?a=&quot;b">z</a>"#),
        ];

        for (input, expected) in cases {
            assert_eq!(
                inner_html_round_trip(input),
                expected,
                "innerHTML round trip diverged from Chrome 153 for {input:?}",
            );
        }
    }

    /// `el.innerHTML = x; el.innerHTML` for the containers whose text children
    /// are serialized literally instead of escaped. Expectations are verbatim
    /// Chrome 153 reads (local headless oracle, same build as the payload).
    ///
    /// Serialization escapes textarea and title (both are RCDATA when parsed)
    /// and emits script, style, xmp, iframe, noembed, noframes, plaintext and
    /// noscript literally. The distinction is invisible for markup that
    /// round-trips exactly, which is why it survived until the challenge's
    /// round-trip probe: that probe stores the markup only when the readback
    /// equals the input, so the six raw containers it uses go empty for us.
    #[test]
    fn raw_text_containers_serialize_like_chrome_153() {
        let p_seq = "<p>EnIF0</p><p>ikyR0</p>";
        let attr = r#"<div data-foo="&quot;"></div>"#;
        let cases: [(&str, &str, &str); 22] = [
            // Ordinary containers: markup round-trips identically.
            ("div", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("div", attr, r#"<div data-foo="&quot;"></div>"#),
            ("template", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("pre", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            // Serialized literally.
            ("script", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("style", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("xmp", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("xmp", attr, r#"<div data-foo="&quot;"></div>"#),
            ("iframe", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("iframe", attr, r#"<div data-foo="&quot;"></div>"#),
            ("noembed", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("noembed", attr, r#"<div data-foo="&quot;"></div>"#),
            ("noframes", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("noframes", attr, r#"<div data-foo="&quot;"></div>"#),
            ("plaintext", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("plaintext", attr, r#"<div data-foo="&quot;"></div>"#),
            ("noscript", p_seq, "<p>EnIF0</p><p>ikyR0</p>"),
            ("noscript", attr, r#"<div data-foo="&quot;"></div>"#),
            // RCDATA when parsed: the decoded text is escaped on the way out.
            (
                "textarea",
                p_seq,
                "&lt;p&gt;EnIF0&lt;/p&gt;&lt;p&gt;ikyR0&lt;/p&gt;",
            ),
            (
                "title",
                p_seq,
                "&lt;p&gt;EnIF0&lt;/p&gt;&lt;p&gt;ikyR0&lt;/p&gt;",
            ),
            (
                "textarea",
                attr,
                r#"&lt;div data-foo="""&gt;&lt;/div&gt;"#,
            ),
            (
                "title",
                attr,
                r#"&lt;div data-foo="""&gt;&lt;/div&gt;"#,
            ),
        ];

        for (tag, input, expected) in cases {
            let tree = parse_html("<body></body>");
            let host = tree.new_node(NodeData::Element {
                name: QualName::new(None, ns!(html), LocalName::from(tag)),
                attrs: Vec::new(),
                template_contents: None,
                mathml_annotation_xml_integration_point: false,
            });
            let context = QualName::new(None, ns!(html), LocalName::from(tag));
            let fragment = parse_fragment_with_context(input, context);
            tree.import_children_from(host, &fragment, fragment.fragment_root());
            assert_eq!(
                tree.inner_html(host),
                expected,
                "innerHTML readback diverged from Chrome 153 for {tag} <- {input:?}",
            );
        }
    }

    /// The characters Chrome 153 escapes in an attribute value versus the ones
    /// it emits raw, for every character the CF payload carries. A value is
    /// always double-quoted, so `'` stays literal, and the ASCII whitespace a
    /// quoted value may contain is not rewritten.
    #[test]
    fn attribute_values_escape_exactly_the_chrome_153_set() {
        let tree = parse_html(r#"<div id="host"></div>"#);
        let cases = [
            ("<", "&lt;"),
            (">", "&gt;"),
            ("&", "&amp;"),
            ("\"", "&quot;"),
            ("'", "'"),
            ("\u{00a0}", "&nbsp;"),
            ("\t\n", "\t\n"),
            ("=", "="),
            ("\u{0300}", "\u{0300}"),
        ];

        for (value, escaped) in cases {
            let el = tree.new_node(NodeData::Element {
                name: QualName::new(None, ns!(html), LocalName::from("div")),
                attrs: vec![crate::tree::Attribute {
                    name: QualName::new(None, ns!(), LocalName::from("a")),
                    value: value.to_string(),
                }],
                template_contents: None,
                mathml_annotation_xml_integration_point: false,
            });
            assert_eq!(
                tree.outer_html(el),
                format!(r#"<div a="{escaped}"></div>"#),
                "attribute value {value:?} serialized differently from Chrome 153",
            );
        }
    }

    /// Text nodes follow the same escape set: Chrome re-escapes NBSP there too,
    /// and leaves `"` alone.
    #[test]
    fn text_nodes_escape_amp_angles_and_nbsp() {
        let tree = parse_html(r#"<div id="host"></div>"#);
        let host = tree.get_element_by_id("host").unwrap();
        let text = tree.new_node(NodeData::Text {
            contents: "<>&\"\u{00a0}".to_string(),
        });
        tree.append_child(host, text);
        assert_eq!(tree.inner_html(host), "&lt;&gt;&amp;\"&nbsp;");
    }

    #[test]
    fn host_serialization_excludes_its_native_shadow_tree() {
        let tree = parse_html(r#"<x-card id="host"><span id="light">light</span></x-card>"#);
        let host = tree.get_element_by_id("host").unwrap();
        let root = tree.attach_shadow_root(host, ShadowRootMode::Open).unwrap();
        let shadow = tree.new_node(NodeData::Element {
            name: QualName::new(None, ns!(html), LocalName::from("strong")),
            attrs: Vec::new(),
            template_contents: None,
            mathml_annotation_xml_integration_point: false,
        });
        let shadow_text = tree.new_node(NodeData::Text {
            contents: "shadow".to_string(),
        });
        tree.append_child(root, shadow);
        tree.append_child(shadow, shadow_text);

        assert_eq!(tree.inner_html(host), r#"<span id="light">light</span>"#);
        assert_eq!(
            tree.outer_html(host),
            r#"<x-card id="host"><span id="light">light</span></x-card>"#
        );
        assert_eq!(tree.inner_html(root), "<strong>shadow</strong>");
    }
}
