//! Every number a `TextMetrics` carries is an SkScalar in the reference: the
//! answer to `v === Math.fround(v)` is true for all ten of them, at every
//! alignment. The aligned bounding boxes are derived from the width, so an
//! unrounded derivation leaks double-only tails the reference cannot produce
//! (`13.680000245571136` against `13.680000305175781`).

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

/// Walks a font/alignment/baseline/text matrix and reports the fields whose
/// value is not representable as f32.
#[tokio::test(flavor = "current_thread")]
async fn text_metrics_numbers_are_skalar_exact_at_every_alignment() {
    let mut rt = runtime();
    let result = rt
        .evaluate_for_cdp(
            r#"(() => {
                const ctx = document.createElement("canvas").getContext("2d");
                const fields = ["width", "actualBoundingBoxLeft", "actualBoundingBoxRight",
                    "fontBoundingBoxAscent", "fontBoundingBoxDescent",
                    "actualBoundingBoxAscent", "actualBoundingBoxDescent",
                    "hangingBaseline", "alphabeticBaseline", "ideographicBaseline"];
                const leaks = [];
                let measured = 0;
                for (const font of ["16px sans-serif", "100px sans-serif", "33px serif",
                                    "17.5px monospace", "16px Arial"]) {
                    for (const align of ["left", "center", "right", "start", "end"]) {
                        for (const baseline of ["alphabetic", "top", "middle"]) {
                            ctx.font = font;
                            ctx.textAlign = align;
                            ctx.textBaseline = baseline;
                            for (const text of ["Hamburg", "iiiii", "....", "\u{1F600}",
                                                "mixed \u{6C49} text", "   ", "a"]) {
                                const m = ctx.measureText(text);
                                measured++;
                                for (const field of fields) {
                                    const value = m[field];
                                    if (typeof value === "number" && value !== Math.fround(value)) {
                                        leaks.push(font + "/" + align + "/" + baseline
                                            + " " + JSON.stringify(text) + " " + field
                                            + "=" + value);
                                    }
                                }
                            }
                        }
                    }
                }
                return { measured, leaks: leaks.slice(0, 12), leakCount: leaks.length };
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
            "measured": 525,
            "leaks": [],
            "leakCount": 0,
        }),
        "every TextMetrics number must survive an f32 round trip"
    );
}
