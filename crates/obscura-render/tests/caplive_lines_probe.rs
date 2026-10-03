//! TEMPORARY: caption line structure probe.
//!
//! Two shapes:
//!   - fixture: the 300px-wrap caplive fixture (predecessor anchor, caph 91)
//!   - live: the CF probe table #bNiRG2 exactly as it sits in the live page
//!     (container 800px, system-ui 14px, table border 2pt, caption 20.99px,
//!     th + td). Chrome truth: table 132.3125x79; caption 111.515625x52 with
//!     two 24px lines; th 62.984375x19; td 59.328125x19; border 2px;
//!     border-spacing 2px.

use obscura_dom::tree_sink::parse_html;
use obscura_render::dom::DomLayout;
use obscura_render::{inline::set_font_platform, layout_dom};

const TABLE_BODY: &str = r#"
        <div id="wrap" style="width:300px;height:260px">
        <table id="tbl" style="border:2pt solid red"><caption id="cap">ttttt cccc tttt</caption><tr id="tr1"><td id="td1">tttt bbbb</td></tr></table>
        </div>
"#;

// Live shape. The ids on caption/th/td are lookup handles only; the live page
// has no id there and only the tag selector `caption` matches.
const LIVE_BODY: &str = r#"
        <div id="cfp" style="width:800px;overflow:hidden;font-family:system-ui;font-size:14px">
        <table id="bNiRG2"><caption id="cap">ttttt cccc tttt</caption><th id="th1">tttt hhhh</th><td id="td1">tttt bbbb</td></table>
        </div>
"#;

const LIVE_STYLE: &str = r#"
        #bNiRG2{border:2pt solid red;margin-left:42.395pt}
        caption{border:2px solid #8b0000;font-size:20.99px;margin-left:20.8px}
"#;

fn dump_style(laid: &DomLayout, id: &str, tree: &obscura_dom::DomTree) {
    let Some(nid) = tree.get_element_by_id(id) else {
        println!("  [{id}] <not found>");
        return;
    };
    let Some(s) = laid.styles.get(&nid) else {
        println!("  [{id}] <no style>");
        return;
    };
    println!(
        "  [{id}] display={:?} border={:.4}/{:.4}/{:.4}/{:.4} padding={:.4}/{:.4}/{:.4}/{:.4}",
        s.display,
        s.border.top,
        s.border.right,
        s.border.bottom,
        s.border.left,
        s.padding.top,
        s.padding.right,
        s.padding.bottom,
        s.padding.left,
    );
    println!(
        "  [{id}] font-size={:?} family={:?} line-height={:?} spacing={:?} collapse={:?}",
        s.font_size, s.font_family, s.line_height, s.border_spacing, s.border_collapse
    );
}

fn dump_rect(laid: &DomLayout, tree: &obscura_dom::DomTree, id: &str) {
    if let Some(nid) = tree.get_element_by_id(id) {
        if let Some(r) = laid.rects.get(&nid) {
            println!(
                "  [{id}] rect {:.4}x{:.4} @ {:.4},{:.4}",
                r.width, r.height, r.x, r.y
            );
        } else {
            println!("  [{id}] <no rect>");
        }
        match laid.cssom_rects.get(&nid) {
            Some(r) => println!(
                "  [{id}] cssom {:.6}x{:.6} @ {:.6},{:.6}",
                r.width, r.height, r.x, r.y
            ),
            None => println!("  [{id}] <no cssom>"),
        }
    } else {
        println!("  [{id}] <not found>");
    }
}

fn dump_subtree(laid: &DomLayout, tree: &obscura_dom::DomTree, id: &str) {
    let Some(root) = tree.get_element_by_id(id) else {
        println!("  [{id}] <not found>");
        return;
    };
    for nid in tree.descendants(root) {
        let Some(node) = tree.get_node(nid) else { continue };
        let Some(q) = node.as_element() else { continue };
        let tag = q.local.as_ref().to_string();
        let attr_id = node.get_attribute("id").unwrap_or("-");
        match laid.rects.get(&nid) {
            Some(r) => println!(
                "  <{tag} id={attr_id}> {:.4}x{:.4} @ {:.4},{:.4}",
                r.width, r.height, r.x, r.y
            ),
            None => println!("  <{tag} id={attr_id}> <no rect>"),
        }
    }
}

fn dump_text(laid: &DomLayout, tree: &obscura_dom::DomTree, id: &str) {
    let Some(root) = tree.get_element_by_id(id) else {
        println!("  [{id}] <not found>");
        return;
    };
    for nid in tree.descendants(root) {
        let Some(node) = tree.get_node(nid) else { continue };
        if !node.is_text() {
            continue;
        }
        if let Some(runs) = laid.text_runs.get(&nid) {
            for (r, w) in runs {
                println!(
                    "  [{id}] text {w:?} run {:.4}x{:.4} @ {:.4},{:.4}",
                    r.width, r.height, r.x, r.y
                );
            }
        } else {
            println!("  [{id}] text node {nid:?} <no runs>");
        }
    }
    if let Some(frags) = laid.inline_fragments.get(&root) {
        for r in frags {
            println!(
                "  [{id}] fragment {:.4}x{:.4} @ {:.4},{:.4}",
                r.width, r.height, r.x, r.y
            );
        }
    }
}

fn run_case(label: &str, body_font: &str, caption_extra: &str, td_extra: &str) {
    set_font_platform("MacIntel");
    let html = format!(
        r#"<html><head><style>
        body{{margin:0{body_font}}}
        caption{{border:2px solid #8b0000;font-size:20.99px;margin-left:20.8px{caption_extra}}}
        td{{{td_extra}}}
        </style></head><body>{TABLE_BODY}</body></html>
"#
    );
    let tree = parse_html(&html);
    let layout = layout_dom(&tree, (1280.0, 800.0));
    for id in ["wrap", "tbl", "cap", "tr1", "td1"] {
        if let Some(nid) = tree.get_element_by_id(id) {
            if let Some(r) = layout.rects.get(&nid) {
                println!(
                    "[{label}] {id}: {:.4}x{:.4} @ {:.4},{:.4}",
                    r.width, r.height, r.x, r.y
                );
            } else {
                println!("[{label}] {id}: <no rect>");
            }
        }
    }
    for (nid, runs) in &layout.text_runs {
        let widths: Vec<String> = runs
            .iter()
            .map(|(r, s)| format!("{:?} w={:.2} y={:.2} h={:.2}", s, r.width, r.y, r.height))
            .collect();
        println!("[{label}] text node {:?}: {}", nid, widths.join(" | "));
    }
    for (nid, frag) in &layout.inline_fragments {
        println!(
            "[{label}] fragments {:?}: {}",
            nid,
            frag
                .iter()
                .map(|r| format!("x={:.2} y={:.2} w={:.2} h={:.2}", r.x, r.y, r.width, r.height))
                .collect::<Vec<_>>()
                .join(" | ")
        );
    }
    // Paint and cluster the dark text rows across the whole probe column.
    let pixmap = obscura_render::paint_dom(&tree, (400.0, 300.0), None).expect("pixmap");
    let mut rows: Vec<(u32, u32)> = Vec::new();
    let mut prev_dark = false;
    for y in 0..200u32 {
        let mut dark = 0;
        for x in 20..80u32 {
            if let Some(px) = pixmap.pixel(x, y) {
                if px.red() < 100 && px.green() < 100 && px.blue() < 100 {
                    dark += 1;
                }
            }
        }
        if dark > 0 {
            match rows.last_mut() {
                Some((_, end)) if prev_dark => *end = y,
                _ => rows.push((y, y)),
            }
            prev_dark = true;
        } else {
            prev_dark = false;
        }
    }
    let spans: Vec<String> = rows
        .iter()
        .map(|(a, b)| format!("{}..{} ({}px)", a, b, b - a + 1))
        .collect();
    println!("[{label}] dark row clusters: {}", spans.join(", "));
}

// 2x2 factor: tag (th bold vs td regular) x text ("tttt hhhh" vs "tttt bbbb").
// Isolated tables, no caption, so the only variable is the cell content width.
// Chrome reference cells: th "tttt hhhh" border-box 62.984375 (content
// 60.984375), td "tttt bbbb" border-box 59.328125 (content 57.328125).
#[test]
fn probe_cell_weight_matrix() {
    obscura_render::inline::set_font_platform("MacIntel");
    let html = r#"<html><head><style>body{margin:0}</style></head><body>
        <div style="font-family:system-ui;font-size:14px">
        <table id="ta"><th id="tha">tttt hhhh</th></table>
        <table id="tb"><th id="thb" style="font-weight:400">tttt hhhh</th></table>
        <table id="tc"><td id="tdc">tttt bbbb</td></table>
        <table id="td2"><th id="thd">tttt bbbb</th></table>
        <table id="te"><td id="tde">tttt hhhh</td></table>
        </div></body></html>"#;
    let tree = parse_html(html);
    let layout = layout_dom(&tree, (1280.0, 800.0));
    println!("== cell weight matrix (Chrome th-hhhh content 60.984375, td-bbbb 57.328125) ==");
    for id in ["ta", "tha", "tb", "thb", "tc", "tdc", "td2", "thd", "te", "tde"] {
        dump_rect(&layout, &tree, id);
    }
    for id in ["tha", "thb", "tdc", "thd", "tde"] {
        dump_style(&layout, id, &tree);
    }
    println!("-- text runs --");
    for id in ["tha", "thb", "tdc", "thd", "tde"] {
        dump_text(&layout, &tree, id);
    }
}

#[test]
fn probe_caplive_lines() {
    run_case("sans", ";font-family:sans-serif", "", "");
    run_case("nofamily", "", "", "");
}

// Diagnostic: is the 36px cell height a wrap at the natural width, or does the
// cell wrap for a structural reason? Variants: natural, forced wide cell,
// single short word, plain flex div (same display as the UA cell), plain block.
#[test]
fn probe_cell_wrap_diag() {
    obscura_render::inline::set_font_platform("MacIntel");
    let cases = [
        ("cell-natural", r#"<table id="t" style="border:0"><tr><td id="c">tttt bbbb</td></tr></table>"#),
        ("cell-wide200", r#"<table id="t" style="border:0"><tr><td id="c" style="width:200px">tttt bbbb</td></tr></table>"#),
        ("cell-short", r#"<table id="t" style="border:0"><tr><td id="c">t</td></tr></table>"#),
        ("flex-div", r#"<div id="c" style="display:flex;padding:1px">tttt bbbb</div>"#),
        ("block-div", r#"<div id="c">tttt bbbb</div>"#),
        ("block-div-w57", r#"<div id="c" style="width:57px">tttt bbbb</div>"#),
    ];
    for (label, frag) in cases {
        let html = format!(
            r#"<html><head><style>body{{margin:0}}</style></head><body><div style="font-family:system-ui;font-size:14px">{frag}</div></body></html>"#
        );
        let tree = parse_html(&html);
        let layout = layout_dom(&tree, (1280.0, 800.0));
        let mut line = format!("[{label}] ");
        for id in ["t", "c"] {
            if let Some(r) = tree.get_element_by_id(id).and_then(|n| layout.rects.get(&n)) {
                line += &format!("{id} {:.4}x{:.4} @ {:.4},{:.4}  ", r.width, r.height, r.x, r.y);
            }
        }
        println!("{line}");
    }
}

// Perturbation matrix for the caption row-track mystery: the live run gives
// track0 = 52 while the caption's natural margin box is 48+4-4+2 = 50. Three
// candididate models: margins counted in the track contribution (H0 responds
// to margin changes), margins ignored (H0 pinned at content+border), or the
// track pass seeing a different content height (25px lines).
const MATRIX_STYLE: &str = r#"
        .t{border:2pt solid red;margin-left:42.395pt}
        caption{border:2px solid #8b0000;font-size:20.99px;margin-left:20.8px}
"#;

#[test]
fn probe_cap_margin_matrix() {
    obscura_render::inline::set_font_platform("MacIntel");
    let variants: [(&str, &str, &str); 5] = [
        ("v0-control", "ttttt cccc tttt", ""),
        ("v1-mb10", "ttttt cccc tttt", "margin-bottom:10px"),
        ("v2-mt10", "ttttt cccc tttt", "margin-top:10px"),
        ("v3-mt-10", "ttttt cccc tttt", "margin-top:-10px"),
        ("v4-oneline", "ttttt", ""),
    ];
    let mut body = String::new();
    for (i, (_, text, extra)) in variants.iter().enumerate() {
        body.push_str(&format!(
            r#"<div id="cfp{i}" style="width:800px;overflow:hidden;font-family:system-ui;font-size:14px">
            <table id="t{i}" class="t"><caption id="c{i}" style="{extra}">{text}</caption><th id="h{i}">tttt hhhh</th><td id="d{i}">tttt bbbb</td></table>
            </div>"#
        ));
    }
    let html = format!(
        r#"<html><head><style>body{{margin:0}}{MATRIX_STYLE}</style></head><body>{body}</body></html>"#
    );
    let tree = parse_html(&html);
    let layout = layout_dom(&tree, (1280.0, 800.0));
    println!("== caption margin matrix (H0 = th.y - 6; target H0 50 with mb=+2,mt=-4) ==");
    for (i, (label, _, _)) in variants.iter().enumerate() {
        println!("-- {label}");
        for id in [format!("t{i}"), format!("c{i}"), format!("h{i}")] {
            dump_rect(&layout, &tree, &id);
        }
    }
}

#[test]
fn probe_live_table() {
    obscura_render::inline::set_font_platform("MacIntel");
    let html = format!(
        r#"<html><head><style>body{{margin:0}}{LIVE_STYLE}</style></head><body>{LIVE_BODY}</body></html>"#
    );
    let tree = parse_html(&html);
    let layout = layout_dom(&tree, (1280.0, 800.0));

    println!("== live table #bNiRG2 (Chrome: 132.3125x79 @ 56.515625,374.9375) ==");
    println!("-- rects --");
    for id in ["cfp", "bNiRG2", "cap", "th1", "td1"] {
        dump_rect(&layout, &tree, id);
    }
    println!("-- computed styles --");
    for id in ["cfp", "bNiRG2", "cap", "th1", "td1"] {
        dump_style(&layout, id, &tree);
    }
    println!("-- table subtree --");
    dump_subtree(&layout, &tree, "bNiRG2");
    println!("-- caption text/lines --");
    dump_text(&layout, &tree, "cap");
    println!("-- th text/lines --");
    dump_text(&layout, &tree, "th1");
    println!("-- td text/lines --");
    dump_text(&layout, &tree, "td1");
}
