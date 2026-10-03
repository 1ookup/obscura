//! Regression: a PingFang-named line box takes the PingFang hhea table, the
//! same one `sans-serif` takes. Chromium 149 on this host grid-fits named
//! PingFang SC exactly like sans-serif (22 at 16px, 29 at 20.99px); the
//! stand-in's own hhea answered 18/19 and 24 before.

use obscura_dom::tree_sink::parse_html;
use obscura_render::{inline::set_font_platform, layout_dom};

#[test]
fn pingfang_named_line_box_matches_the_generic() {
    set_font_platform("MacIntel");
    let tree = parse_html(
        r#"<html><head><style>
        body{margin:0}
        .lb{display:inline-block;line-height:normal;white-space:nowrap}
        </style></head><body>
        <div id="sans" class="lb" style="font-family:sans-serif;font-size:20.99px">x</div>
        <div id="sysui" class="lb" style="font-family:system-ui;font-size:20.99px">x</div>
        <div id="pf" class="lb" style="font-family:'PingFang SC';font-size:20.99px">x</div>
        <div id="serif" class="lb" style="font-family:serif;font-size:20.99px">x</div>
        <div id="pf16" class="lb" style="font-family:'PingFang SC';font-size:16px">x</div>
        </body></html>
        "#,
    );
    let layout = layout_dom(&tree, (1280.0, 800.0));
    let height = |id: &str| {
        let nid = tree.get_element_by_id(id).expect(id);
        layout.rects.get(&nid).expect("line box").height
    };
    // Chromium 149 on this host, 2026-10-03.
    assert_eq!(height("sans"), 29.0);
    assert_eq!(height("sysui"), 24.0);
    assert_eq!(height("pf"), 29.0, "named PingFang SC must take the hhea table");
    assert_eq!(height("serif"), 29.0);
    assert_eq!(height("pf16"), 22.0, "named PingFang SC at 16px must read 22");
}
