import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let fileManager = FileManager.default
let currentDir = URL(fileURLWithPath: fileManager.currentDirectoryPath)
let outputDir = currentDir.appendingPathComponent("assets/alerts", isDirectory: true)
let width: CGFloat = 1600
let height: CGFloat = 900

struct BannerConfig {
    let name: String
    let accentStart: NSColor
    let accentEnd: NSColor
    let edgeGlow: NSColor
    let title: String
    let subtitle: String
}

let banners: [BannerConfig] = [
    BannerConfig(
        name: "new-signal-cyan",
        accentStart: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.24, green: 0.96, blue: 0.88, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 0.88),
        title: "NEW SIGNAL",
        subtitle: "Soloris Signals"
    ),
    BannerConfig(
        name: "new-signal-gold",
        accentStart: NSColor(calibratedRed: 0.98, green: 0.80, blue: 0.22, alpha: 1),
        accentEnd: NSColor(calibratedRed: 1.00, green: 0.93, blue: 0.53, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.98, green: 0.80, blue: 0.22, alpha: 0.88),
        title: "NEW SIGNAL",
        subtitle: "Soloris Signals"
    ),
    BannerConfig(
        name: "profits",
        accentStart: NSColor(calibratedRed: 0.08, green: 0.73, blue: 0.52, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.34, green: 0.95, blue: 0.64, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.08, green: 0.73, blue: 0.52, alpha: 0.92),
        title: "PROFITS",
        subtitle: "Soloris Signals"
    ),
    BannerConfig(
        name: "loss",
        accentStart: NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.27, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.99, green: 0.56, blue: 0.29, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.27, alpha: 0.90),
        title: "LOSS",
        subtitle: "Soloris Signals"
    )
]

func makeGradient(_ start: NSColor, _ end: NSColor) -> NSGradient {
    NSGradient(colors: [start, end])!
}

func drawRoundedRect(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke = stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func drawText(_ text: String, in rect: NSRect, font: NSFont, color: NSColor, alignment: NSTextAlignment = .left) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: style
    ]
    text.draw(in: rect, withAttributes: attrs)
}

func drawGlowCircle(at point: CGPoint, radius: CGFloat, color: NSColor, alpha: CGFloat) {
    let glowColor = color.withAlphaComponent(alpha)
    let path = NSBezierPath(
        ovalIn: NSRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
    )
    glowColor.setFill()
    path.fill()
}

func drawSweep(in ctx: CGContext, rect: CGRect, color: NSColor, phase: CGFloat) {
    let sweepWidth: CGFloat = 180
    let x = rect.minX + (rect.width + sweepWidth * 2) * phase - sweepWidth
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color.withAlphaComponent(0.0).cgColor,
            color.withAlphaComponent(0.22).cgColor,
            color.withAlphaComponent(0.0).cgColor
        ] as CFArray,
        locations: [0.0, 0.5, 1.0]
    )!
    ctx.saveGState()
    let clipPath = CGPath(roundedRect: rect, cornerWidth: 34, cornerHeight: 34, transform: nil)
    ctx.addPath(clipPath)
    ctx.clip()
    ctx.rotate(by: -.pi / 16)
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: x, y: rect.minY),
        end: CGPoint(x: x + sweepWidth, y: rect.maxY),
        options: []
    )
    ctx.restoreGState()
}

func drawTitleShimmer(in ctx: CGContext, rect: CGRect, color: NSColor, phase: CGFloat) {
    let sweepWidth: CGFloat = 260
    let x = rect.minX + (rect.width + sweepWidth * 2) * phase - sweepWidth
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color.withAlphaComponent(0.0).cgColor,
            color.withAlphaComponent(0.20).cgColor,
            color.withAlphaComponent(0.32).cgColor,
            color.withAlphaComponent(0.0).cgColor
        ] as CFArray,
        locations: [0.0, 0.35, 0.6, 1.0]
    )!
    ctx.saveGState()
    let clipPath = CGPath(roundedRect: rect, cornerWidth: 26, cornerHeight: 26, transform: nil)
    ctx.addPath(clipPath)
    ctx.clip()
    ctx.rotate(by: -.pi / 18)
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: x, y: rect.minY),
        end: CGPoint(x: x + sweepWidth, y: rect.maxY),
        options: []
    )
    ctx.restoreGState()
}

func drawLogo(in rect: NSRect, accentStart: NSColor, accentEnd: NSColor, edgeGlow: NSColor, phase: CGFloat) {
    let panel = NSBezierPath(roundedRect: rect, xRadius: 34, yRadius: 34)
    NSColor(calibratedRed: 0.03, green: 0.05, blue: 0.10, alpha: 0.96).setFill()
    panel.fill()

    let border = NSBezierPath(roundedRect: rect.insetBy(dx: 2, dy: 2), xRadius: 32, yRadius: 32)
    edgeGlow.withAlphaComponent(0.24 + (0.08 * phase)).setStroke()
    border.lineWidth = 4
    border.stroke()

    let cx = rect.midX
    let cy = rect.midY
    let arc = NSBezierPath()
    arc.move(to: CGPoint(x: rect.minX + 26, y: rect.minY + 44))
    arc.curve(
        to: CGPoint(x: rect.maxX - 16, y: rect.maxY - 18),
        controlPoint1: CGPoint(x: rect.minX + 68, y: rect.maxY - 16),
        controlPoint2: CGPoint(x: rect.maxX - 60, y: rect.maxY - 4)
    )
    arc.lineWidth = 16
    arc.lineCapStyle = .round
    makeGradient(accentStart, accentEnd).draw(in: arc, angle: 18)

    let arrow = NSBezierPath()
    arrow.move(to: CGPoint(x: rect.maxX - 38, y: rect.maxY - 56))
    arrow.line(to: CGPoint(x: rect.maxX - 4, y: rect.maxY - 18))
    arrow.line(to: CGPoint(x: rect.maxX - 30, y: rect.maxY - 14))
    arrow.line(to: CGPoint(x: rect.maxX - 18, y: rect.maxY - 42))
    arrow.close()
    makeGradient(accentStart.highlight(withLevel: 0.18) ?? accentStart, accentEnd).draw(in: arrow, angle: -35)

    let candleX = [cx - 34, cx - 10, cx + 14]
    let candleHeights: [CGFloat] = [40, 58, 76]
    for (idx, x) in candleX.enumerated() {
        let h = candleHeights[idx]
        let wick = NSBezierPath()
        wick.move(to: CGPoint(x: x, y: cy - 18))
        wick.line(to: CGPoint(x: x, y: cy + h / 2))
        wick.lineWidth = 5
        wick.lineCapStyle = .round
        NSColor(calibratedWhite: 0.94, alpha: 0.96).setStroke()
        wick.stroke()

        let body = NSBezierPath(
            roundedRect: NSRect(x: x - 10, y: cy - 10, width: 20, height: h * 0.55),
            xRadius: 6,
            yRadius: 6
        )
        NSColor(calibratedWhite: 0.96, alpha: 0.98).setFill()
        body.fill()
    }

    drawGlowCircle(
        at: CGPoint(x: rect.maxX - 30, y: rect.maxY - 20),
        radius: 34,
        color: edgeGlow,
        alpha: 0.10 + (0.06 * phase)
    )
}

func makeImage(config: BannerConfig, phase: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: width, height: height))
    image.lockFocus()
    guard let ctx = NSGraphicsContext.current?.cgContext else {
        fatalError("Unable to create context")
    }

    let bg = NSRect(x: 0, y: 0, width: width, height: height)
    drawRoundedRect(bg, radius: 0, fill: NSColor(calibratedRed: 0.02, green: 0.04, blue: 0.08, alpha: 1))

    let gridColor = NSColor(calibratedRed: 0.11, green: 0.15, blue: 0.22, alpha: 0.55)
    ctx.setStrokeColor(gridColor.cgColor)
    ctx.setLineWidth(1)
    stride(from: 0 as CGFloat, through: width, by: 92).forEach { x in
        ctx.move(to: CGPoint(x: x, y: 0))
        ctx.addLine(to: CGPoint(x: x, y: height))
    }
    stride(from: 0 as CGFloat, through: height, by: 92).forEach { y in
        ctx.move(to: CGPoint(x: 0, y: y))
        ctx.addLine(to: CGPoint(x: width, y: y))
    }
    ctx.strokePath()

    let glow = NSGradient(colors: [
        config.edgeGlow.withAlphaComponent(0.18 + (0.08 * phase)),
        config.edgeGlow.withAlphaComponent(0)
    ])!
    glow.draw(
        in: NSRect(x: width - 620, y: height - 340, width: 520, height: 260),
        relativeCenterPosition: NSPoint(x: 0.65, y: 0.5)
    )

    let brandBand = NSRect(x: 60, y: height - 200, width: width - 120, height: 120)
    drawRoundedRect(
        brandBand,
        radius: 34,
        fill: NSColor(calibratedRed: 0.05, green: 0.08, blue: 0.14, alpha: 0.92),
        stroke: config.edgeGlow.withAlphaComponent(0.22 + (0.10 * phase)),
        lineWidth: 2
    )
    drawSweep(in: ctx, rect: brandBand, color: config.edgeGlow, phase: phase)

    drawLogo(
        in: NSRect(x: 92, y: height - 184, width: 170, height: 170),
        accentStart: config.accentStart,
        accentEnd: config.accentEnd,
        edgeGlow: config.edgeGlow,
        phase: phase
    )

    let pulse = sin(phase * .pi)

    let titleBlockWidth: CGFloat = 720
    let titleBlockX: CGFloat = (width - titleBlockWidth) / 2
    let titleRect = NSRect(x: titleBlockX, y: height - 146, width: titleBlockWidth, height: 96)
    let titleHaloRect = NSRect(x: titleBlockX - 120, y: height - 250, width: titleBlockWidth + 240, height: 190)
    let titleHalo = NSGradient(colors: [
        config.edgeGlow.withAlphaComponent(0.18 + (0.12 * pulse)),
        config.edgeGlow.withAlphaComponent(0.04 + (0.03 * pulse)),
        config.edgeGlow.withAlphaComponent(0.0)
    ])!
    titleHalo.draw(in: titleHaloRect, relativeCenterPosition: NSPoint(x: 0.0, y: 0.25))
    drawTitleShimmer(
        in: ctx,
        rect: NSRect(x: titleBlockX - 40, y: height - 196, width: titleBlockWidth + 80, height: 118),
        color: config.edgeGlow,
        phase: phase
    )
    drawText(
        config.title,
        in: titleRect.offsetBy(dx: 0, dy: 0),
        font: NSFont.systemFont(ofSize: 88, weight: .black),
        color: config.edgeGlow.withAlphaComponent(0.18 + (0.12 * pulse)),
        alignment: .center
    )
    drawText(
        config.title,
        in: titleRect,
        font: NSFont.systemFont(ofSize: 88, weight: .black),
        color: NSColor(calibratedWhite: 0.985, alpha: 1),
        alignment: .center
    )
    drawText(
        config.subtitle,
        in: NSRect(x: titleBlockX, y: height - 204, width: titleBlockWidth, height: 48),
        font: NSFont(name: "Snell Roundhand Bold", size: 38) ?? NSFont.systemFont(ofSize: 38, weight: .semibold),
        color: config.accentStart.blended(withFraction: 0.25 * pulse, of: .white) ?? config.accentStart,
        alignment: .center
    )

    let subtitleLine = NSRect(x: titleBlockX + 170, y: height - 222, width: titleBlockWidth - 340, height: 4)
    drawRoundedRect(
        subtitleLine,
        radius: 2,
        fill: config.edgeGlow.withAlphaComponent(0.12 + (0.12 * pulse))
    )

    let signalCapsule = NSRect(x: width - 422, y: height - 148, width: 300, height: 58)
    drawRoundedRect(
        signalCapsule,
        radius: 24,
        fill: NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.14, alpha: 0.95),
        stroke: config.edgeGlow.withAlphaComponent(0.28 + (0.18 * pulse)),
        lineWidth: 2
    )
    drawText(
        "AUTO SIGNAL",
        in: NSRect(x: signalCapsule.minX, y: signalCapsule.minY + 11, width: signalCapsule.width, height: 32),
        font: NSFont.monospacedSystemFont(ofSize: 22, weight: .semibold),
        color: config.accentEnd,
        alignment: .center
    )

    let footer = NSRect(x: 60, y: 72, width: width - 120, height: 72)
    drawRoundedRect(
        footer,
        radius: 26,
        fill: NSColor(calibratedRed: 0.05, green: 0.08, blue: 0.13, alpha: 0.85)
    )
    drawText(
        "soloris-signals.vercel.app",
        in: NSRect(x: 94, y: 92, width: 360, height: 28),
        font: NSFont.monospacedSystemFont(ofSize: 19, weight: .medium),
        color: NSColor(calibratedWhite: 0.72, alpha: 0.88)
    )
    drawText(
        config.title,
        in: NSRect(x: width - 400, y: 90, width: 280, height: 28),
        font: NSFont.monospacedSystemFont(ofSize: 19, weight: .bold),
        color: config.edgeGlow,
        alignment: .right
    )

    image.unlockFocus()
    return image
}

func writeGif(named name: String, frames: [NSImage], duration: Double) throws {
    let url = outputDir.appendingPathComponent("\(name).gif")
    guard let destination = CGImageDestinationCreateWithURL(
        url as CFURL,
        UTType.gif.identifier as CFString,
        frames.count,
        nil
    ) else {
        throw NSError(domain: "banner", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to create GIF destination"])
    }

    let gifProps = [
        kCGImagePropertyGIFDictionary: [
            kCGImagePropertyGIFLoopCount: 0
        ]
    ] as CFDictionary
    CGImageDestinationSetProperties(destination, gifProps)

    let frameProps = [
        kCGImagePropertyGIFDictionary: [
            kCGImagePropertyGIFDelayTime: duration
        ]
    ] as CFDictionary

    for image in frames {
        guard
            let tiff = image.tiffRepresentation,
            let rep = NSBitmapImageRep(data: tiff),
            let cgImage = rep.cgImage
        else {
            throw NSError(domain: "banner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to render GIF frame"])
        }
        CGImageDestinationAddImage(destination, cgImage, frameProps)
    }

    if !CGImageDestinationFinalize(destination) {
        throw NSError(domain: "banner", code: 3, userInfo: [NSLocalizedDescriptionKey: "Unable to finalize GIF"])
    }
}

try fileManager.createDirectory(at: outputDir, withIntermediateDirectories: true)
fileManager.createFile(atPath: outputDir.appendingPathComponent(".keep").path, contents: Data(), attributes: nil)

let frameCount = 10
let frameDuration = 0.11

for banner in banners {
    var frames: [NSImage] = []
    for frameIndex in 0..<frameCount {
        let phase = CGFloat(frameIndex) / CGFloat(frameCount - 1)
        frames.append(makeImage(config: banner, phase: phase))
    }
    try writeGif(named: banner.name, frames: frames + frames.dropLast().reversed(), duration: frameDuration)
    print("Wrote \(outputDir.appendingPathComponent("\(banner.name).gif").path)")
}
