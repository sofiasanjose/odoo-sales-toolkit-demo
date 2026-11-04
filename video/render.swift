// Frame renderer for the walkthrough video.
// Reads a timeline JSON (shots with camera moves, highlight boxes, captions)
// and writes raw BGRA frames to stdout for ffmpeg:
//   swift render.swift timeline.json | ffmpeg -f rawvideo -pix_fmt bgra -s 1920x1080 -r 30 -i - ...
import AppKit
import Foundation

struct HL: Decodable { let r: [Double]; let t0: Double; let t1: Double }
struct Shot: Decodable {
    let img: String; let scale: Double; let start: Double; let dur: Double
    let from: [Double]; let to: [Double]; let hls: [HL]
    let mv: Double?   // fraction of the shot the camera move takes, then it holds
}
struct Cap: Decodable { let text: String; let t0: Double; let t1: Double }
struct Timeline: Decodable { let fps: Double; let total: Double; let shots: [Shot]; let captions: [Cap]; let xfade: Double }

let W = 1920, H = 1080
let tl = try! JSONDecoder().decode(Timeline.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))

// decode each image once into a bitmap so per-frame drawing is cheap
var images: [String: CGImage] = [:]
for s in tl.shots where images[s.img] == nil {
    let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: s.img) as CFURL, nil)!
    let img = CGImageSourceCreateImageAtIndex(src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)!
    images[s.img] = img
}

let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: cs,
                    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
ctx.interpolationQuality = .high
let nsctx = NSGraphicsContext(cgContext: ctx, flipped: false)
let bg = CGColor(red: 0xF6 / 255, green: 0xF4 / 255, blue: 0xEF / 255, alpha: 1)
let orange = CGColor(red: 0xF7 / 255, green: 0x67 / 255, blue: 0x07 / 255, alpha: 1)

func ease(_ x: Double) -> Double { let t = max(0, min(1, x)); return t * t * (3 - 2 * t) }  // smoothstep

/// camera = [x, y, w] in CSS px (top-left origin); height follows 16:9
func camera(_ s: Shot, _ t: Double) -> (Double, Double, Double) {
    let p = ease(t / (s.dur * (s.mv ?? 1)))
    let x = s.from[0] + (s.to[0] - s.from[0]) * p
    let y = s.from[1] + (s.to[1] - s.from[1]) * p
    let w = s.from[2] + (s.to[2] - s.from[2]) * p
    return (x, y, w)
}

func drawShot(_ s: Shot, _ t: Double, alpha: Double) {
    let img = images[s.img]!
    let (cx, cy, cw) = camera(s, t)
    let ch = cw * 9 / 16
    let z = Double(W) / cw                       // CSS px -> screen px
    ctx.saveGState()
    ctx.setAlpha(CGFloat(alpha))
    ctx.setFillColor(bg)
    ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    // visible part of the image, in image px
    let iw = Double(img.width), ih = Double(img.height)
    let vx0 = max(0, cx * s.scale), vy0 = max(0, cy * s.scale)
    let vx1 = min(iw, (cx + cw) * s.scale), vy1 = min(ih, (cy + ch) * s.scale)
    if vx1 > vx0 && vy1 > vy0, let crop = img.cropping(to: CGRect(x: vx0, y: vy0, width: vx1 - vx0, height: vy1 - vy0)) {
        // where that crop lands on screen (top-left coords), then flip to CG's bottom-left
        let dx = (vx0 / s.scale - cx) * z, dy = (vy0 / s.scale - cy) * z
        let dw = (vx1 - vx0) / s.scale * z, dh = (vy1 - vy0) / s.scale * z
        ctx.draw(crop, in: CGRect(x: dx, y: Double(H) - dy - dh, width: dw, height: dh))
    }
    // highlight boxes
    for h in s.hls where t >= h.t0 && t <= h.t1 {
        let a = min(1, (t - h.t0) / 0.3, (h.t1 - t) / 0.3)
        let pad = 10.0
        let r = CGRect(x: (h.r[0] - pad - cx) * z, y: 0, width: (h.r[2] + 2 * pad) * z, height: (h.r[3] + 2 * pad) * z)
        let top = (h.r[1] - pad - cy) * z
        let rect = CGRect(x: r.minX, y: Double(H) - top - r.height, width: r.width, height: r.height)
        let path = CGPath(roundedRect: rect, cornerWidth: 14, cornerHeight: 14, transform: nil)
        ctx.setAlpha(CGFloat(alpha * a))
        ctx.addPath(path); ctx.setFillColor(CGColor(red: 0xF7 / 255, green: 0x67 / 255, blue: 0x07 / 255, alpha: 0.07)); ctx.fillPath()
        ctx.addPath(path); ctx.setStrokeColor(orange); ctx.setLineWidth(6); ctx.strokePath()
    }
    ctx.restoreGState()
}

let para = NSMutableParagraphStyle(); para.alignment = .center; para.lineBreakMode = .byWordWrapping
let capAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 40, weight: .semibold), .foregroundColor: NSColor.white, .paragraphStyle: para]

func drawCaption(_ c: Cap, _ t: Double) {
    let a = min(1, (t - c.t0) / 0.15, (c.t1 - t) / 0.15)
    let s = NSAttributedString(string: c.text, attributes: capAttrs)
    let maxW = 1500.0
    let b = s.boundingRect(with: NSSize(width: maxW, height: 400), options: [.usesLineFragmentOrigin, .usesFontLeading])
    let bw = ceil(b.width) + 56, bh = ceil(b.height) + 30
    let box = CGRect(x: (Double(W) - bw) / 2, y: 46, width: bw, height: bh)
    ctx.saveGState()
    ctx.setAlpha(CGFloat(a))
    ctx.addPath(CGPath(roundedRect: box, cornerWidth: 16, cornerHeight: 16, transform: nil))
    ctx.setFillColor(CGColor(red: 0.07, green: 0.09, blue: 0.1, alpha: 0.82)); ctx.fillPath()
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = nsctx
    s.draw(with: CGRect(x: box.minX + 28, y: box.minY + 15, width: bw - 56, height: bh - 30), options: [.usesLineFragmentOrigin, .usesFontLeading])
    NSGraphicsContext.restoreGraphicsState()
    ctx.restoreGState()
}

let out = FileHandle.standardOutput
let frames = Int((tl.total * tl.fps).rounded())
for f in 0..<frames {
    let t = Double(f) / tl.fps
    ctx.setFillColor(bg); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
    let active = tl.shots.filter { t >= $0.start && t < $0.start + $0.dur }
    for (i, s) in active.enumerated() {
        let alpha = i == 0 ? 1.0 : min(1, (t - s.start) / tl.xfade)
        drawShot(s, t - s.start, alpha: alpha)
    }
    for c in tl.captions where t >= c.t0 && t < c.t1 { drawCaption(c, t) }
    out.write(Data(bytesNoCopy: ctx.data!, count: W * H * 4, deallocator: .none))
    if f % 300 == 0 { FileHandle.standardError.write("frame \(f)/\(frames)\n".data(using: .utf8)!) }
}
