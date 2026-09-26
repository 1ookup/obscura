//! The CF challenge measures ten emoji through an `OffscreenCanvas` 2D context
//! (`16px sans-serif`), so the offscreen path has to answer the same per-glyph
//! numbers the element canvas does. Both contexts are one implementation
//! (`OffscreenCanvas.getContext('2d')` builds the same `_Canvas2D`, and the
//! offscreen prototype holds the very same `measureText` function object), and
//! these tests pin that: lose the shared entry and every emoji collapses onto
//! one advance and one ascent again, which is the shape a real browser never
//! produces when it covers the run.

#![cfg(feature = "render")]

use obscura_js::runtime::ObscuraJsRuntime;

fn runtime() -> ObscuraJsRuntime {
    let dom = obscura_dom::parse_html("<html><body></body></html>");
    let mut rt = ObscuraJsRuntime::new();
    rt.set_dom(dom);
    rt.set_url("http://example.com/test");
    rt.set_title("Test Page");
    rt.run_page_init();
    rt
}

/// The ten emoji the challenge measures, in its order.
const PROBE: &str = r#"
    [["grinning","\u{1F600}"], ["rofl","\u{1F923}"], ["heartEyes","\u{1F60D}"],
     ["thumbsUp","\u{1F44D}"], ["fire","\u{1F525}"], ["rocket","\u{1F680}"],
     ["brain","\u{1F9E0}"], ["dog","\u{1F436}"], ["castle","\u{1F3EF}"],
     ["sun","\u{2600}\u{FE0F}"]]
"#;

/// The challenge's ten emoji measured through `OffscreenCanvas` keep their own
/// advance and their own ink ascent: the identity sans face's emoji table is
/// consulted on the offscreen path exactly as it is on the element canvas.
///
/// 😀 = 👍 = 🚀 is *correct* — those three share one advance in the face, as
/// they do in the reference. What would be a regression is the ten of them
/// collapsing onto one pair of numbers.
#[tokio::test(flavor = "current_thread")]
async fn offscreen_2d_measure_text_answers_per_glyph_emoji() {
    let mut rt = runtime();
    let result = rt
        .evaluate_for_cdp(
            &format!(
                r#"(() => {{
                    const ctx = new OffscreenCanvas(300, 150).getContext("2d");
                    ctx.font = "16px sans-serif";
                    const rows = {PROBE};
                    const out = {{}};
                    for (const [name, text] of rows) {{
                        const m = ctx.measureText(text);
                        out[name] = [m.width, m.actualBoundingBoxAscent];
                    }}
                    return out;
                }})()"#
            ),
            true,
            true,
        )
        .await
        .unwrap()
        .value
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "grinning":  [28.70400047302246, 12.128000259399414],
            "rofl":      [22.304000854492188, 12.128000259399414],
            "heartEyes": [15.984000205993652, 12.859375],
            "thumbsUp":  [28.70400047302246, 12.128000259399414],
            "fire":      [25.503999710083008, 12.128000259399414],
            "rocket":    [28.70400047302246, 12.128000259399414],
            "brain":     [20.167999267578125, 13.343999862670898],
            "dog":       [25.176000595092773, 12.97599983215332],
            "castle":    [15.984000205993652, 10.671875],
            "sun":       [32.84000015258789, 11.456000328063965],
        }),
        "the offscreen emoji probe must stay per glyph"
    );
}

/// Same context state, same answer. Every field a `TextMetrics` carries has to
/// agree bit for bit between the element canvas and the offscreen one, over
/// emoji, plain text, a monospace face and the whitespace/empty edges, because
/// a probe that measures through one and compares against the other reads the
/// disagreement.
#[tokio::test(flavor = "current_thread")]
async fn offscreen_2d_and_canvas_measure_text_agree_for_the_same_arguments() {
    let mut rt = runtime();
    let result = rt
        .evaluate_for_cdp(
            r#"(() => {
                const canvas = document.createElement("canvas").getContext("2d");
                const offscreen = new OffscreenCanvas(300, 150).getContext("2d");
                const fields = ["width", "actualBoundingBoxLeft", "actualBoundingBoxRight",
                    "fontBoundingBoxAscent", "fontBoundingBoxDescent",
                    "actualBoundingBoxAscent", "actualBoundingBoxDescent",
                    "hangingBaseline", "alphabeticBaseline", "ideographicBaseline"];
                const texts = ["\u{1F600}", "\u{1F923}", "\u{1F9E0}", "\u{2600}\u{FE0F}",
                    "Hello World", "iiiii", "\u{6C49}\u{5B57}", "   ", "", "a"];
                const diffs = [];
                for (const font of ["16px sans-serif", "16px monospace", "33px serif",
                                    "italic 16px sans-serif"]) {
                    for (const align of ["left", "center", "right"]) {
                        for (const baseline of ["alphabetic", "top", "middle"]) {
                            for (const direction of ["inherit", "ltr", "rtl"]) {
                                for (const text of texts) {
                                    const answer = (ctx) => {
                                        ctx.font = font;
                                        ctx.textAlign = align;
                                        ctx.textBaseline = baseline;
                                        ctx.direction = direction;
                                        const m = ctx.measureText(text);
                                        const out = {};
                                        for (const field of fields) out[field] = m[field];
                                        return out;
                                    };
                                    const a = answer(canvas);
                                    const b = answer(offscreen);
                                    for (const field of fields) {
                                        if (a[field] !== b[field]) {
                                            diffs.push(font + "/" + align + "/" + baseline
                                                + "/" + direction + " "
                                                + JSON.stringify(text) + " " + field
                                                + ": " + a[field] + " vs " + b[field]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                return { diffs: diffs.slice(0, 8), diffCount: diffs.length };
            })()"#,
            true,
            true,
        )
        .await
        .unwrap()
        .value
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!({"diffs": [], "diffCount": 0}),
        "canvas and OffscreenCanvas must answer identically for identical state"
    );
}

/// The offscreen context keeps the shared entry by construction, not by luck:
/// its prototype owns the same member set as the canvas one and its
/// `measureText` *is* the canvas one, so patching one metric reaches both
/// surfaces. A boot-order or descriptor-copy surprise is what would split them.
#[tokio::test(flavor = "current_thread")]
async fn offscreen_2d_shares_the_canvas_measure_text_entry() {
    let mut rt = runtime();
    let result = rt
        .evaluate_for_cdp(
            r#"(() => {
                const canvas = document.createElement("canvas").getContext("2d");
                const offscreen = new OffscreenCanvas(300, 150).getContext("2d");
                const canvasProto = Object.getPrototypeOf(canvas);
                const offProto = Object.getPrototypeOf(offscreen);
                const members = (proto) => Object.getOwnPropertyNames(proto)
                    .filter((name) => name !== "constructor").sort();
                const canvasMembers = members(canvasProto);
                const offMembers = members(offProto);
                const missing = canvasMembers.filter((name) => !offMembers.includes(name));
                const extra = offMembers.filter((name) => !canvasMembers.includes(name));
                const offParent = Object.getPrototypeOf(offProto) === Object.prototype;
                // Every numeric answer is an SkScalar on the offscreen path too.
                const fields = ["width", "actualBoundingBoxLeft", "actualBoundingBoxRight",
                    "fontBoundingBoxAscent", "fontBoundingBoxDescent",
                    "actualBoundingBoxAscent", "actualBoundingBoxDescent",
                    "hangingBaseline", "alphabeticBaseline", "ideographicBaseline"];
                offscreen.font = "16px sans-serif";
                const leaks = [];
                for (const text of ["\u{1F600}", "Hello", "\u{6C49}"]) {
                    const m = offscreen.measureText(text);
                    for (const field of fields) {
                        const value = m[field];
                        if (typeof value === "number" && value !== Math.fround(value)) {
                            leaks.push(text + " " + field + "=" + value);
                        }
                    }
                }
                return {
                    sharedMeasureText: canvasProto.measureText === offProto.measureText,
                    missing, extra,
                    offParent,
                    offTag: Object.prototype.toString.call(offscreen),
                    canvasTag: Object.prototype.toString.call(canvas),
                    offIsOff: offscreen instanceof OffscreenCanvasRenderingContext2D,
                    offIsCanvas: offscreen instanceof CanvasRenderingContext2D,
                    leaks,
                };
            })()"#,
            true,
            true,
        )
        .await
        .unwrap()
        .value
        .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "sharedMeasureText": true,
            "missing": [],
            "extra": [],
            "offParent": true,
            // Chrome's offscreen interface owns its members (its parent is
            // Object.prototype, not the canvas interface) and keeps its own
            // branding, so the sharing is of implementations and not of identity.
            "offTag": "[object OffscreenCanvasRenderingContext2D]",
            "canvasTag": "[object CanvasRenderingContext2D]",
            "offIsOff": true,
            "offIsCanvas": false,
            "leaks": [],
        }),
        "the offscreen context must keep the canvas metric entry and its own branding"
    );
}
