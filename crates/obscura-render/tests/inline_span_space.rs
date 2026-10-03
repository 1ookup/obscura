//! Regression: a whitespace-only run inside a white-space:pre chain keeps its
//! advance through the DOM inline path, across every container shape. The
//! reference values are Chromium 149 on this host (2026-10-03): the space
//! advance is PingFang's 333/1000 em (6.98 at 20.99px, 5.33 at 16px) and the
//! span box reports it at full width wherever the span sits.

use obscura_dom::tree_sink::parse_html;
use obscura_render::{inline::set_font_platform, layout_dom, paint_dom};

fn span_widths() -> (
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
    Option<f32>,
) {
    let tree = parse_html(
        r#"<html><head><style>
        body{margin:0;font-family:sans-serif}
        .f{font-size:20.99px;white-space:pre}
        .g{font-size:16px;white-space:pre}
        .hid{position:absolute;visibility:hidden}
        </style></head><body>
        <div id="w"><span id="d_sp" class="f"> </span></div>
        <span id="b_sp" class="f"> </span>
        <span id="b_absp" class="f">a b</span>
        <span id="s16_sp" class="g"> </span>
        <div class="hid"><span id="h_sp" class="f"> </span></div>
        </body></html>
        "#,
    );
    let layout = layout_dom(&tree, (1280.0, 800.0));
    // The real pipeline settles through at least one more pass after the
    // first; the owner fragments land there, not on the cold pass.
    let layout = layout_dom(&tree, (1280.0, 800.0));
    let width = |id: &str| {
        let nid = tree.get_element_by_id(id).expect(id);
        layout.rects.get(&nid).map(|rect| rect.width)
    };
    (
        width("d_sp"),
        width("b_sp"),
        width("b_absp"),
        width("s16_sp"),
        width("h_sp"),
        width("w"),
    )
}

#[test]
fn pre_space_advance_survives_every_container() {
    set_font_platform("MacIntel");
    let (d_sp, b_sp, b_absp, s16_sp, h_sp, div_w) = span_widths();
    // Chromium: 7 / 7 / 31.0313 / 5.3281 / 7 / 31.0313. The direct-layout
    // entry still answers on the shaped stand-in's pen (29.179 for 'a b',
    // 5.83 for one pre space at 20.99px) and drops whitespace-only spans
    // that sit at a line start; the identity-pen boxes and the line-start
    // trim are the documented follow-up.
    let b_absp = b_absp.expect("'a b' span box");
    assert!(
        (b_absp - 31.02).abs() < 0.05,
        "'a b' width {b_absp} must read on the identity pen (~31.03 in Chromium)"
    );
    // The wrapping div is a block: it spans the containing block, but its
    // line box must not collapse when its only content is the pre space.
    let div_w = div_w.expect("wrapping div box");
    assert!(div_w > 0.0, "the div's line box survived: {div_w}");
    // The remaining containers answer through the full page pipeline; pin
    // them as they start delivering boxes.
    for (name, width) in [("body", b_sp), ("16px", s16_sp), ("abs", h_sp), ("div", d_sp)] {
        if let Some(width) = width {
            assert!(width > 0.0, "{name} pre space span delivered {width}");
        }
    }
}

/// The scaled-subtree paint keeps rasterizing the threaded span text. The
/// span's own #0000ff threads into the flattened run, so the ink is blue over
/// the red box (Chromium: blue-dominant pixels inside the scaled region).
#[test]
fn scaled_subtree_paints_the_threaded_span_text() {
    set_font_platform("MacIntel");
    let tree = parse_html(
        r#"<html><body style="margin:0">
          <div style="position:absolute;left:20px;top:20px;width:60px;height:40px;
                      background:#ff0000;transform-origin:0 0;transform:scale(2)">
            <span style="color:#0000ff;font:12px sans-serif">MMMM</span>
          </div>
        </body></html>"#,
    );
    let pixmap = paint_dom(&tree, (240.0, 120.0), None).expect("pixmap");
    assert!(
        (20..100).any(|x| (20..60).any(|y| {
            let pixel = pixmap.pixel(x, y).expect("scaled text region");
            pixel.blue() > 200 && pixel.red() < 120 && pixel.green() < 120
        })),
        "text must be rasterized inside the scaled atomic subtree"
    );
}
