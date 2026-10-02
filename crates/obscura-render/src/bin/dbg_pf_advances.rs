// dbg_pf_advances.rs: enumerate PingFang.ttc faces, print per-face advances for M/t/b/i/space.
#![allow(non_snake_case)]
use std::ffi::{c_void, CString};
use std::sync::Arc;

use core_text as _ct_link;
use core_text::font_descriptor::CTFontDescriptor as _ctd_keep;

type CFAllocatorRef = *const c_void;
type CFURLRef = *const c_void;
type CFStringRef = *const c_void;
type CTFontRef = *const c_void;
type CTFontDescriptorRef = *const c_void;
type CGGlyph = u16;
const K_CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;
extern "C" {
    fn CFURLCreateWithFileSystemPath(a: CFAllocatorRef, p: CFStringRef, style: isize, tilde: bool) -> CFURLRef;
    fn CFStringCreateWithCString(a: CFAllocatorRef, s: *const c_void, enc: u32) -> CFStringRef;
    fn CTFontManagerCreateFontDescriptorsFromURL(u: CFURLRef) -> CFAllocatorRef;
    fn CFArrayGetCount(a: CFAllocatorRef) -> isize;
    fn CFArrayGetValueAtIndex(a: CFAllocatorRef, i: isize) -> CTFontDescriptorRef;
    fn CTFontCreateWithFontDescriptor(d: CTFontDescriptorRef, size: f64, m: *const c_void) -> CTFontRef;
    fn CTFontCopyFamilyName(f: CTFontRef) -> CFStringRef;
    fn CTFontCopyPostScriptName(f: CTFontRef) -> CFStringRef;
    fn CTFontGetGlyphsForCharacters(f: CTFontRef, c: *const u16, g: *mut CGGlyph, n: isize) -> bool;
    fn CTFontGetAdvancesForGlyphs(f: CTFontRef, o: u32, g: *const CGGlyph, a: *mut f64, n: usize) -> f64;
}
unsafe fn cf_str(s: &str) -> CFStringRef {
    let c = CString::new(s).unwrap();
    CFStringCreateWithCString(std::ptr::null_mut(), c.as_ptr() as *const c_void, K_CFSTRING_ENCODING_UTF8)
}
unsafe fn cf_to_rust(s: CFStringRef) -> String {
    let mut buf = [0u8; 256];
    let mut ok = false;
    // CFStringGetCString
    {
        extern "C" { fn CFStringGetCString(s: CFStringRef, b: *mut u8, n: isize, e: u32) -> bool; }
        ok = CFStringGetCString(s, buf.as_mut_ptr(), 256, K_CFSTRING_ENCODING_UTF8);
    }
    if ok { let end = buf.iter().position(|c| *c == 0).unwrap_or(0); String::from_utf8_lossy(&buf[..end]).into_owned() } else { String::from("?") }
}
fn main() {
    unsafe {
        let url = CFURLCreateWithFileSystemPath(std::ptr::null_mut(), cf_str("/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc"), 0, false);
        let descs = CTFontManagerCreateFontDescriptorsFromURL(url);
        println!("descs-null={}" , descs.is_null());
        let n = CFArrayGetCount(descs);
        eprintln!("faces: {}", n);
        let chars: Vec<u16> = "Mtb i".encode_utf16().collect();
        for i in 0..n {
            let desc = CFArrayGetValueAtIndex(descs, i);
            let font = CTFontCreateWithFontDescriptor(desc, 100.0, std::ptr::null_mut());
            let fam = cf_to_rust(CTFontCopyFamilyName(font));
            let ps = cf_to_rust(CTFontCopyPostScriptName(font));
            let mut advs = [0f64; 5];
            for (ci, ch) in chars.iter().enumerate() {
                let mut g = [0u16; 1];
                if CTFontGetGlyphsForCharacters(font, ch, g.as_mut_ptr(), 1) {
                    CTFontGetAdvancesForGlyphs(font, 1, g.as_ptr(), advs.as_mut_ptr().add(ci), 1);
                }
            }
            // size=100pt: advance(pt) = 100 * units/upem; report ratio-to-100 for units view
            let u: Vec<String> = advs.iter().map(|a| format!("{:.1}", a)).collect();
            eprintln!("face[{}] fam={} ps={} adv(pt@100)=[{}]", i, fam, ps, u.join(","));
        }
    }
}
