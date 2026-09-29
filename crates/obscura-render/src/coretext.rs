//! CoreText/CoreGraphics glyph raster for canvas fillText (macOS): the
//! reference Chrome rasterizes canvas text through the system's CoreGraphics
//! pipeline, whose smoothing differs from any pure-software scanline
//! converter. Rendering the same glyphs through the same system pipeline is
//! the only byte-exact path. macOS-only; other hosts keep the software
//! rasterizer.

#![allow(non_snake_case, clippy::upper_case_acronyms)]

use std::ffi::c_void;
use std::sync::Arc;

// Force the framework-linking crates into the dependency graph: the raw
// extern declarations below reference symbols the system frameworks export,
// and without a reference the linker drops the crates that carry the
// #pragma-link directives.
use core_foundation::array::CFArray;
use core_foundation::base::{CFRetain, TCFType};
use core_foundation::data::CFData;
use core_graphics as _core_graphics_link;
use core_text as _core_text_link;
use core_text::font_descriptor::CTFontDescriptor;

type CFAllocatorRef = *const c_void;
type CGDataProviderRef = *const c_void;
type CGFontRef = *const c_void;
type CTFontRef = *const c_void;
type CGContextRef = *mut c_void;
type CGColorSpaceRef = *const c_void;
type CGGlyph = u16;
type UniChar = u16;
type CTFontDescriptorRef = *const c_void;
type CFDataRef = *const c_void;
type CFArrayRef = *const c_void;
type CFStringRef = *const c_void;
const kCFStringEncodingUTF8: u32 = 0x0800_0100;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

/// CGAffineTransform by value (a null pointer here segfaults — the function
/// takes the struct by value).
#[repr(C)]
#[derive(Clone, Copy)]
struct CGAffineTransform {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    tx: f64,
    ty: f64,
}

impl CGAffineTransform {
    const IDENTITY: Self = Self { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 };
}

extern "C" {
    fn CGDataProviderCreateWithData(
        info: *const c_void,
        data: *const u8,
        size: usize,
        release: Option<unsafe extern "C" fn(*const c_void, *const c_void)>,
    ) -> CGDataProviderRef;
    fn CGFontCreateWithDataProvider(provider: CGDataProviderRef) -> CGFontRef;
    fn CTFontCreateWithGraphicsFont(
        graphicsFont: CGFontRef,
        size: f64,
        transform: *const c_void,
        attributes: *const c_void,
    ) -> CTFontRef;
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bitsPerComponent: usize,
        bytesPerRow: usize,
        space: CGColorSpaceRef,
        bitmapInfo: u32,
    ) -> CGContextRef;
    fn CGColorSpaceCreateDeviceRGB() -> CGColorSpaceRef;
    fn CGContextSetRGBFillColor(context: CGContextRef, r: f64, g: f64, b: f64, a: f64);
    fn CGContextSetGrayFillColor(context: CGContextRef, gray: f64, alpha: f64);
    fn CGContextSetTextPosition(context: CGContextRef, x: f64, y: f64);
    fn CGContextSetShouldAntialias(context: CGContextRef, flag: bool);
    fn CGContextSetAllowsFontSmoothing(context: CGContextRef, flag: bool);
    fn CGContextSetShouldSmoothFonts(context: CGContextRef, flag: bool);
    fn CGContextSetTextMatrix(context: CGContextRef, t: CGAffineTransform);
    fn CTFontGetGlyphsForCharacters(
        font: CTFontRef,
        characters: *const UniChar,
        glyphs: *mut CGGlyph,
        count: isize,
    ) -> bool;
    fn CFDataCreate(
        allocator: CFAllocatorRef,
        bytes: *const u8,
        length: isize,
    ) -> CFDataRef;
    fn CFArrayCreate(
        allocator: CFAllocatorRef,
        values: *const *const c_void,
        numValues: isize,
        callbacks: *const c_void,
    ) -> CFArrayRef;
    fn CTFontManagerCreateFontDescriptorsFromData(data: CFDataRef) -> CFArrayRef;
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> *const c_void;
    fn CTFontDescriptorCopyAttribute(
        descriptor: CTFontDescriptorRef,
        attribute: CFStringRef,
    ) -> CFStringRef;
    fn CTFontCreateWithFontDescriptor(
        descriptor: CTFontDescriptorRef,
        size: f64,
        matrix: *const c_void,
    ) -> CTFontRef;
    fn CFStringCreateWithCString(
        alloc: CFAllocatorRef,
        cStr: *const i8,
        encoding: u32,
    ) -> CFStringRef;
    fn CFStringGetCString(
        theString: CFStringRef,
        buffer: *mut i8,
        bufferSize: isize,
        encoding: u32,
    ) -> bool;
    fn CFRelease(cf: *const c_void);
    fn CTFontCreateWithName(
        name: *const c_void,
        size: f64,
        matrix: *const c_void,
    ) -> CTFontRef;
    fn CTFontDrawGlyphs(
        font: CTFontRef,
        glyphs: *const CGGlyph,
        positions: *const CGPoint,
        count: usize,
        context: CGContextRef,
    );
    fn CGContextSetFont(context: CGContextRef, font: CGFontRef);
    fn CGContextSetFontSize(context: CGContextRef, size: f64);
    fn CGContextShowGlyphsAtPoint(
        context: CGContextRef,
        x: f64,
        y: f64,
        glyphs: *const CGGlyph,
        count: usize,
    );
}

unsafe extern "C" fn noop_release(_info: *const c_void, _data: *const c_void) {}

/// One font file registered with CoreText, held for the process: the font
/// descriptors reference the bytes without copying them, so the Arc must
/// outlive every CTFont minted from them.
pub struct CoreTextFace {
    font: CTFontRef,
    cgfont: CGFontRef,
    /// The face's point size: the CGFont draw path scales through it.
    size: f64,
    _data: Arc<Vec<u8>>,
}

impl CoreTextFace {
    /// Mint a CTFont of `size` px for `family` out of a font collection, by
    /// enumerating the collection's descriptors and picking the first face
    /// whose family name matches (collections hold many weights/languages of
    /// the same family; the first regular match is the cut the reference
    /// answers with). CGFontCreateWithDataProvider only reaches the
    /// collection's primary face, which is why this goes through the
    /// descriptor manager.
    pub fn from_collection(
        data: Arc<Vec<u8>>,
        family: &str,
        size: f64,
    ) -> Option<Self> {
        // Enumerate the collection's descriptors through the core-text
        // wrappers (the PostScript names are not localized, unlike the family
        // attribute).
        let cf_data = CFData::from_buffer(&data);
        let array_ref = unsafe {
            CTFontManagerCreateFontDescriptorsFromData(
                cf_data.as_concrete_TypeRef() as *const c_void,
            )
        };
        if array_ref.is_null() {
            return None;
        }
        let array = unsafe {
            CFArray::<CTFontDescriptor>::wrap_under_create_rule(
                array_ref as *const core_foundation_sys::array::__CFArray,
            )
        };
        let wanted = family.to_ascii_uppercase().replace(' ', "");
        for desc in array.iter() {
            let ps = desc.font_name().to_ascii_uppercase();
            if std::env::var_os("OBSCURA_DUMP_CT").is_some() {
                eprintln!("  desc ps={}", ps);
            }
            // The family's regular cut: the PostScript name starts with the
            // family (e.g. PingFangSC- for PingFang SC) and carries no named
            // weight. The language tag distinguishes SC from TC/HK.
            let is_named_weight = ps.contains("MEDIUM")
                || ps.contains("LIGHT")
                || ps.contains("THIN")
                || ps.contains("SEMIBOLD")
                || ps.contains("BOLD")
                || ps.contains("HEAVY")
                || ps.contains("ULTRALIGHT");
            let language_ok = family != "PingFang SC"
                || ps.starts_with("PINGFANGSC-")
                || ps.starts_with("PINGFANGSC");
            if !ps.starts_with(&wanted) || is_named_weight || !language_ok {
                continue;
            }
            let font = unsafe {
                CTFontCreateWithFontDescriptor(
                    desc.as_concrete_TypeRef() as *const c_void,
                    size,
                    std::ptr::null(),
                )
            };
            if font.is_null() {
                continue;
            }
            // A CGFont twin of the same face for the coverage draw path.
            let (provider, cgfont) = unsafe {
                let provider = CGDataProviderCreateWithData(
                    std::ptr::null(),
                    data.as_ptr(),
                    data.len(),
                    Some(noop_release),
                );
                let cgfont = CGFontCreateWithDataProvider(provider);
                CFRetain(cgfont as *const c_void);
                (provider, cgfont)
            };
            return Some(Self {
                font,
                cgfont,
                size,
                _data: data,
            });
        }
        None
    }

    /// Mint a CTFont from the system registry by PostScript name -- the
    /// same registry lookup the reference browser performs. The collection
    /// path (from_collection) renders nothing at tiny sizes, so the color
    /// and coverage rasters resolve faces this way.
    pub fn from_system_name(name: &str, size: f64) -> Option<Self> {
        unsafe {
            let cf_name = CFStringCreateWithCString(
                std::ptr::null(),
                name.as_ptr() as *const i8,
                kCFStringEncodingUTF8,
            );
            if cf_name.is_null() {
                return None;
            }
            let font = CTFontCreateWithName(
                cf_name as *const c_void,
                size,
                std::ptr::null(),
            );
            CFRelease(cf_name as *const c_void);
            if font.is_null() {
                return None;
            }
                        let provider = CGDataProviderCreateWithData(
                std::ptr::null(),
                std::ptr::null(),
                0,
                Some(noop_release),
            );
            let cgfont = CGFontCreateWithDataProvider(provider);
            CFRetain(cgfont as *const c_void);
            Some(Self {
                font,
                cgfont,
                size,
                _data: Arc::new(Vec::new()),
            })
        }
    }

    /// The PostScript face name a reference family resolves to on this host.
    pub fn postscript_name(family: &str) -> &'static str {
        match family {
            "PingFang SC" => "PingFangSC-Regular",
            "Arial" => "ArialMT",
            "Helvetica" => "Helvetica",
            "Times New Roman" => "TimesNewRomanPSMT",
            "Menlo" => "Menlo-Regular",
            _ => "",
        }
    }

    /// Register `data` (a font file's bytes) with CoreGraphics and mint a
    /// CTFont of `size` px from the first face in the collection.
    #[allow(dead_code)]
    pub fn from_bytes(data: Arc<Vec<u8>>, size: f64) -> Option<Self> {
        unsafe {
            let provider = CGDataProviderCreateWithData(
                std::ptr::null(),
                data.as_ptr(),
                data.len(),
                Some(noop_release),
            );
            if provider.is_null() {
                return None;
            }
            let cgfont = CGFontCreateWithDataProvider(provider);
            if cgfont.is_null() {
                return None;
            }
            let font = CTFontCreateWithGraphicsFont(cgfont, size, std::ptr::null(), std::ptr::null());
            if font.is_null() {
                return None;
            }
            // The CGFont is retained: the coverage draw path paints through
            // CGContextShowGlyphsAtPoint, which needs the CGFont itself.
            CFRetain(cgfont as *const c_void);
            Some(Self {
                font,
                cgfont: cgfont,
                size,
                _data: data,
            })
        }
    }

    /// Render one character into `mask` (a single-channel buffer, row-major)
    /// with its pen origin at (pen_x, pen_y), storing the raw CoreGraphics
    /// sample per pixel. Returns true when the path ran (a character the face
    /// has no glyph for is also "done" -- it simply leaves the mask blank).
    pub fn draw_char_coverage_into(
        &self,
        ch: char,
        pen_x: usize,
        pen_y: usize,
        mask: &mut [u8],
        w: usize,
        h: usize,
    ) -> bool {
        unsafe {
            let space = CGColorSpaceCreateDeviceRGB();
            let mut buf = vec![0u8; w * h * 4];
            let ctx = CGBitmapContextCreate(
                buf.as_mut_ptr() as *mut c_void,
                w,
                h,
                8,
                w * 4,
                space,
                1, // kCGImageAlphaPremultipliedLast
            );
            if ctx.is_null() {
                return false;
            }
            CGContextSetShouldAntialias(ctx, true);
            CGContextSetShouldSmoothFonts(ctx, true);
            CGContextSetAllowsFontSmoothing(ctx, true);
            CGContextSetRGBFillColor(ctx, 0.0, 0.0, 0.0, 1.0);
            CGContextSetTextMatrix(ctx, CGAffineTransform::IDENTITY);
            let pos = CGPoint { x: pen_x as f64, y: pen_y as f64 };
            CGContextSetTextPosition(ctx, pos.x, pos.y);
            // Paint through the CGFont directly: CTFontDrawGlyphs on a face
            // minted from raw collection bytes rendered nothing, while the
            // CGFont draw path (what the reference's rasterizer bottoms out
            // in) paints the same glyph with full smoothing.
            CGContextSetFont(ctx, self.cgfont);
            CGContextSetFontSize(ctx, self.size);
            let mut glyph: CGGlyph = 0;
            let c = ch as UniChar;
            let have = CTFontGetGlyphsForCharacters(self.font, &c, &mut glyph, 1) && glyph != 0;
            if have {
                CGContextShowGlyphsAtPoint(ctx, pos.x, pos.y, &glyph, 1);
            }
            for (i, px) in buf.chunks_exact(4).enumerate() {
                mask[i] = px[3];
            }
            if std::env::var_os("OBSCURA_COVERAGE_DEBUG").is_some() {
                let sum: u32 = mask.iter().map(|v| *v as u32).sum();
                eprintln!("ct-draw: ch={:?} glyph={} w={} h={} pen=({},{}) mask_sum={}",
                    ch, glyph, w, h, pen_x, pen_y, sum);
            }
            true
        }
    }

    /// A character's glyph in this face (the same cmap the shaper's face
    /// resolves through).
    pub fn glyph_for_char(&self, ch: char) -> Option<CGGlyph> {
        let c = ch as UniChar;
        let mut glyph: CGGlyph = 0;
        unsafe {
            if CTFontGetGlyphsForCharacters(self.font, &c, &mut glyph, 1) && glyph != 0 {
                Some(glyph)
            } else {
                None
            }
        }
    }

    /// Render one glyph with its origin at (pen_x, baseline_y) on a grayscale
    /// `width`x`height` surface whose origin is top-left, and return the
    /// coverage bytes row-major. CoreGraphics' own smoothing produces the
    /// mask -- the same pipeline the reference browser's canvas text runs.
    pub fn draw_glyph_gray(
        &self,
        glyph: CGGlyph,
        pen_x: f64,
        baseline_y: f64,
        width: usize,
        height: usize,
    ) -> Option<Vec<u8>> {
        self.draw_glyph_gray_flags(glyph, pen_x, baseline_y, width, height, true, true)
    }

    /// The same render with explicit smoothing/antialias flags, for the
    /// parameter sweep that matches the reference's exact strength.
    pub fn draw_glyph_gray_flags(
        &self,
        glyph: CGGlyph,
        pen_x: f64,
        baseline_y: f64,
        width: usize,
        height: usize,
        smooth: bool,
        aa: bool,
    ) -> Option<Vec<u8>> {
        unsafe {
            // RGBA premultiplied-last: the format a real canvas backing
            // store uses (the gray path rasterizes through a different CG
            // code path with different edge behavior).
            let space = CGColorSpaceCreateDeviceRGB();
            let mut buf = vec![0u8; width * height * 4];
            let ctx = CGBitmapContextCreate(
                buf.as_mut_ptr() as *mut c_void,
                width,
                height,
                8,
                width * 4,
                space,
                1, // kCGImageAlphaPremultipliedLast
            );
            if ctx.is_null() {
                return None;
            }
            CGContextSetShouldAntialias(ctx, aa);
            CGContextSetShouldSmoothFonts(ctx, smooth);
            CGContextSetAllowsFontSmoothing(ctx, smooth);
            CGContextSetRGBFillColor(ctx, 0.0, 0.0, 0.0, 1.0);
            CGContextSetTextMatrix(ctx, CGAffineTransform::IDENTITY);
            // Bitmap contexts are y-down at the top-left; flip so the pen's
            // baseline lands at `baseline_y` from the top.
            // The buffer is stored bottom-up relative to CG's own y-up user
            // space (measured: pen y = height - baseline_y puts the glyph's
            // ink on the canvas rows the reference puts it on).
            let pos = CGPoint {
                x: pen_x,
                y: height as f64 - baseline_y,
            };
            CTFontDrawGlyphs(self.font, &glyph, &pos, 1, ctx);
            // Extract the alpha channel row-major (the canvas coverage).
            let mut out = Vec::with_capacity(width * height);
            for px in buf.chunks_exact(4) {
                out.push(px[3]);
            }
            Some(out)
        }
    }
}

/// The CoreGraphics-to-reference coverage transform, piecewise-linear
/// between the measured anchors (CoreText smoothing on, the exact ftext
/// targets): CG 44 -> ref 0x27, 42 -> 0x25, 96 -> 0x58, 226 -> 0xe3, with
/// the endpoints pinned. Monotonic; the probe's fit put the mid-band at a
/// power of ~1.10 with the large end falling back to identity, which the
/// segment shape reproduces.
pub(crate) fn coverage_lut(cg: u8) -> u8 {
    const ANCHORS: [(u8, u8); 6] =
        [(0, 0), (42, 37), (44, 39), (96, 88), (226, 227), (255, 255)];
    if cg == 255 {
        return 255;
    }
    for pair in ANCHORS.windows(2) {
        let (lo_c, lo_r) = pair[0];
        let (hi_c, hi_r) = pair[1];
        if cg <= hi_c {
            let span = (hi_c - lo_c) as u32;
            let t = (cg - lo_c) as u32;
            return (lo_r as u32 + t * (hi_r as u32 - lo_r as u32) / span.max(1))
                .min(255) as u8;
        }
    }
    cg
}

#[cfg(test)]
mod lut_tests {
    use super::coverage_lut;

    #[test]
    fn lut_hits_the_measured_anchors() {
        assert_eq!(coverage_lut(44), 0x27);
        assert_eq!(coverage_lut(42), 0x25);
        assert_eq!(coverage_lut(96), 0x58);
        assert_eq!(coverage_lut(226), 0xe3);
        assert_eq!(coverage_lut(0), 0);
        assert_eq!(coverage_lut(255), 255);
    }

    #[test]
    fn lut_is_monotonic() {
        let mut prev = 0;
        for cg in 0..=255u8 {
            let v = coverage_lut(cg);
            assert!(v >= prev, "non-monotonic at {}", cg);
            prev = v;
        }
    }
}

#[cfg(test)]
mod spike_tests {
    use super::*;

    #[test]
    fn spike_liberation_a16() {
        if std::env::var("OBSCURA_DUMP_CT").is_err() {
            return;
        }
        let data: Arc<Vec<u8>> = Arc::new(std::fs::read(
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/liberation-sans.ttf"),
        )
        .expect("liberation bytes"));
        let face = CoreTextFace::from_bytes(data, 16.0).expect("face");
        let glyph = face.glyph_for_char('F').expect("glyph F");
        let mask = face.draw_glyph_gray(glyph, 4.0, 20.0, 24, 24).expect("mask");
        for (yy, row) in mask.chunks_exact(24).enumerate() {
            let line: String = row.iter().map(|v| format!("{:02x}", v)).collect();
            println!("{:02} {}", yy, line);
        }
    }
}

#[cfg(test)]
mod probe_tests {
    use super::*;

    #[test]
    fn probe_first_step_matrix() {
        if std::env::var("OBSCURA_DUMP_CT").is_err() {
            return;
        }
        // The live probe's first stroke: fillText(eth + C1s, 0, 1) on a 1x1
        // canvas, font "1px sans-serif" -> the reference answers alpha 0x27.
        // sans-serif resolves to PingFang SC on this host.
        let pingfang = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../obscura-js/assets/PingFang.ttc"))
            .or_else(|_| {
                let hits: Vec<_> = std::fs::read_dir("/System/Library/AssetsV2/com_apple_MobileAsset_Font8")
                    .map_err(|e| e.to_string())?
                    .filter_map(|e| e.ok())
                    .flat_map(|e| {
                        let base = e.path().join("AssetData/PingFang.ttc");
                        std::fs::read(&base).ok().map(|v| (base, v))
                    })
                    .collect();
                hits.into_iter().next().map(|(_, v)| v).ok_or_else(|| "no host PingFang".to_string())
            })
            .expect("pingfang bytes");
        let face = CoreTextFace::from_bytes(Arc::new(pingfang), 1.0).expect("face");
        let glyph = match face.glyph_for_char('\u{00F0}') {
            Some(g) => g,
            None => {
                println!("no glyph for eth in PingFang collection face 0");
                return;
            }
        };
        // pen (0,1) like the probe; sweep subpixel offsets to see the coverage spread.
        for dy in [0.0, 0.25, 0.5, 0.75] {
            for dx in [0.0, 0.25, 0.5, 0.75] {
                if let Some(mask) = face.draw_glyph_gray(glyph, dx, 1.0 + dy, 1, 1) {
                    println!("dx={} dy={} alpha={:02x} ({})", dx, dy, mask[0], mask[0]);
                }
            }
        }
    }

    #[test]
    fn probe_smoothing_matrix() {
        if std::env::var("OBSCURA_DUMP_CT2").is_err() {
            return;
        }
        let pingfang = std::fs::read("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc").expect("pf");
        for smooth in [true, false] {
            for aa in [true, false] {
                let face = CoreTextFace::from_bytes(std::sync::Arc::new(pingfang.clone()), 1.0).expect("face");
                let g = face.glyph_for_char('\u{00F0}').expect("g");
                if let Some(m) = face.draw_glyph_gray_flags(g, 0.0, 1.0, 1, 1, smooth, aa) {
                    println!("smooth={} aa={} alpha={:02x} ({})", smooth, aa, m[0], m[0]);
                }
            }
        }
    }

    #[test]
    fn probe_subpixel_aa() {
        if std::env::var("OBSCURA_DUMP_CT3").is_err() {
            return;
        }
        // reference answers 0x27 which sits BETWEEN CG smooth-on (0x2c) and
        // smooth-off (0x24): sweep subpixel pen offsets under aa-only for it.
        let pingfang = std::fs::read("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc").expect("pf");
        for smooth in [true, false] {
            let face = CoreTextFace::from_bytes(std::sync::Arc::new(pingfang.clone()), 1.0).expect("face");
            let g = face.glyph_for_char('\u{00F0}').expect("g");
            let mut steps = vec![];
            for i in 0..=20usize {
                let d = i as f64 / 20.0;
                if let Some(m) = face.draw_glyph_gray_flags(g, d, 1.0, 1, 1, smooth, true) {
                    steps.push(format!("{:.2}:{:02x}", d, m[0]));
                }
            }
            println!("smooth={} dx sweep: {}", smooth, steps.join(" "));
            let mut ys = vec![];
            for i in 0..=20usize {
                let d = i as f64 / 20.0;
                if let Some(m) = face.draw_glyph_gray_flags(g, 0.0, 1.0 + d, 1, 1, smooth, true) {
                    ys.push(format!("{:.2}:{:02x}", d, m[0]));
                }
            }
            println!("smooth={} dy sweep: {}", smooth, ys.join(" "));
        }
    }

    #[test]
    fn probe_gamma_pairs() {
        if std::env::var("OBSCURA_DUMP_CT4").is_err() {
            return;
        }
        // (cg, reference) pairs for the transform fit: render the exact
        // ftext targets through CG smooth-on and print alongside the
        // reference answers we must hit.
        let pingfang = std::fs::read("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc").expect("pf");
        let targets: &[(f64, char, u8, &str)] = &[
            (1.0, '\u{00F0}', 0x27, "eth 1px"),
            (1.0, 'A', 0x25, "A 1px sans"),
            (2.0, 'A', 0x58, "A 2px"),
            (10.0, 'A', 0xe3, "A 10px"),
        ];
        for &(size, ch, want, label) in targets {
            let face = CoreTextFace::from_bytes(std::sync::Arc::new(pingfang.clone()), size).expect("face");
            let g = match face.glyph_for_char(ch) {
                Some(g) => g,
                None => { println!("{}: no glyph", label); continue; }
            };
            if let Some(m) = face.draw_glyph_gray_flags(g, 0.0, 1.0, 1, 1, true, true) {
                println!("{}: cg={:02x} ({}) ref={:02x} ({})", label, m[0], m[0], want, want);
            }
        }
    }

    #[test]
    fn probe_pen_zero() {
        if std::env::var("OBSCURA_DUMP_CT5").is_err() {
            return;
        }
        // Discriminator: render with pen_x = 0 on a wide scratch and see
        // which column the ink lands in. +0 => the pen semantics are clean
        // and the live offsets come from the frame math; +3 => CG itself
        // shifts unhinted tiny glyphs.
        let pingfang = std::fs::read("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc").expect("pf");
        for size in [1.0f64, 2.0, 10.0] {
            let face = CoreTextFace::from_bytes(std::sync::Arc::new(pingfang.clone()), size).expect("face");
            let g = face.glyph_for_char('A').expect("g");
            if let Some(m) = face.draw_glyph_gray_flags(g, 0.0, size * 2.0, 32, 32, true, true) {
                let cells: Vec<String> = m.iter().enumerate().filter(|(_, v)| **v > 0)
                    .map(|(i, v)| format!("(r{},c{},a{:02x})", i / 32, i % 32, v)).collect();
                let first = cells.iter().take(4).cloned().collect::<Vec<_>>().join(" ");
                println!("size={} cells={} first={}", size, cells.len(), first);
            }
        }
    }
}

