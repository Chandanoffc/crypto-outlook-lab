import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let fileManager = FileManager.default
let scriptDir = URL(fileURLWithPath: (#filePath as String), isDirectory: false).deletingLastPathComponent()
let outputDir = scriptDir
let width: CGFloat = 1600
let height: CGFloat = 900

struct BannerConfig {
    let name: String
    let accentStart: NSColor
    let accentEnd: NSColor
    let edgeGlow: NSColor
    let title: String
    let subtitle: String
    let motionStyle: MotionStyle
}

enum MotionStyle {
    case siren
    case confetti
    case warn
    case safe
}

let banners: [BannerConfig] = [
    BannerConfig(
        name: "new-signal-cyan",
        accentStart: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.24, green: 0.96, blue: 0.88, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 0.88),
        title: "NEW SIGNAL",
        subtitle: "Soloris Signals",
        motionStyle: .siren
    ),
    BannerConfig(
        name: "new-signal-gold",
        accentStart: NSColor(calibratedRed: 0.98, green: 0.80, blue: 0.22, alpha: 1),
        accentEnd: NSColor(calibratedRed: 1.00, green: 0.93, blue: 0.53, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.98, green: 0.80, blue: 0.22, alpha: 0.88),
        title: "NEW SIGNAL",
        subtitle: "Soloris Signals",
        motionStyle: .siren
    ),
    BannerConfig(
        name: "new-perps-alert",
        accentStart: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.24, green: 0.96, blue: 0.88, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 0.88),
        title: "NEW PERPS ALERT",
        subtitle: "Soloris Signals",
        motionStyle: .siren
    ),
    BannerConfig(
        name: "new-dlmm-alert",
        accentStart: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.24, green: 0.96, blue: 0.88, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.18, green: 0.83, blue: 0.98, alpha: 0.88),
        title: "NEW DLMM ALERT",
        subtitle: "Soloris Signals",
        motionStyle: .siren
    ),
    BannerConfig(
        name: "profits",
        accentStart: NSColor(calibratedRed: 0.08, green: 0.73, blue: 0.52, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.34, green: 0.95, blue: 0.64, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.08, green: 0.73, blue: 0.52, alpha: 0.92),
        title: "PROFITS",
        subtitle: "Soloris Signals",
        motionStyle: .confetti
    ),
    BannerConfig(
        name: "loss",
        accentStart: NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.27, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.99, green: 0.56, blue: 0.29, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.27, alpha: 0.90),
        title: "LOSS",
        subtitle: "Soloris Signals",
        motionStyle: .warn
    ),
    BannerConfig(
        name: "safe",
        accentStart: NSColor(calibratedRed: 0.12, green: 0.56, blue: 0.94, alpha: 1),
        accentEnd: NSColor(calibratedRed: 0.38, green: 0.87, blue: 0.99, alpha: 1),
        edgeGlow: NSColor(calibratedRed: 0.38, green: 0.87, blue: 0.99, alpha: 0.92),
        title: "SAFE",
        subtitle: "Soloris Signals",
        motionStyle: .safe
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

func drawSignalSweep(in ctx: CGContext, rect: CGRect, color: NSColor, phase: CGFloat) {
    let lineY = rect.minY + rect.height * (0.30 + 0.48 * phase)
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color.withAlphaComponent(0).cgColor,
            color.withAlphaComponent(0.35).cgColor,
            color.withAlphaComponent(0.75).cgColor,
            color.withAlphaComponent(0.35).cgColor,
            color.withAlphaComponent(0).cgColor
        ] as CFArray,
        locations: [0.0, 0.35, 0.5, 0.65, 1.0]
    )!
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: rect.minX + 80, y: lineY),
        end: CGPoint(x: rect.maxX - 80, y: lineY),
        options: []
    )
    ctx.setStrokeColor(color.withAlphaComponent(0.55).cgColor)
    ctx.setLineWidth(2)
    ctx.move(to: CGPoint(x: rect.minX + 110, y: lineY))
    ctx.addLine(to: CGPoint(x: rect.maxX - 110, y: lineY))
    ctx.strokePath()
    ctx.restoreGState()
}

func drawProfitLift(in ctx: CGContext, rect: CGRect, start: NSColor, end: NSColor, phase: CGFloat) {
    let pulse = sin(phase * .pi)
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    let centerX = rect.midX
    for idx in 0..<3 {
        let offset = CGFloat(idx - 1) * 90
        let barWidth: CGFloat = 44
        let rise = rect.minY + 16 + CGFloat(idx) * 10 + 20 * pulse
        let barHeight = 60 + CGFloat(idx) * 32 + 30 * pulse
        let barRect = CGRect(x: centerX + offset - barWidth / 2, y: rise, width: barWidth, height: barHeight)
        let gradient = CGGradient(
            colorsSpace: CGColorSpaceCreateDeviceRGB(),
            colors: [
                start.withAlphaComponent(0.10).cgColor,
                end.withAlphaComponent(0.42 + 0.10 * pulse).cgColor
            ] as CFArray,
            locations: [0, 1]
        )!
        let path = CGPath(roundedRect: barRect, cornerWidth: 12, cornerHeight: 12, transform: nil)
        ctx.addPath(path)
        ctx.clip()
        ctx.drawLinearGradient(gradient, start: CGPoint(x: barRect.midX, y: barRect.minY), end: CGPoint(x: barRect.midX, y: barRect.maxY), options: [])
        ctx.resetClip()
        ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
        ctx.clip()
    }

    let arrowPath = CGMutablePath()
    arrowPath.move(to: CGPoint(x: rect.midX - 160, y: rect.minY + 60 + 16 * pulse))
    arrowPath.addCurve(
        to: CGPoint(x: rect.midX + 180, y: rect.maxY - 58),
        control1: CGPoint(x: rect.midX - 40, y: rect.midY - 20),
        control2: CGPoint(x: rect.midX + 88, y: rect.midY + 30)
    )
    ctx.addPath(arrowPath)
    ctx.setStrokeColor(end.withAlphaComponent(0.55 + 0.12 * pulse).cgColor)
    ctx.setLineWidth(8)
    ctx.setLineCap(.round)
    ctx.strokePath()
    ctx.restoreGState()
}

func drawConfetti(in ctx: CGContext, rect: CGRect, start: NSColor, end: NSColor, phase: CGFloat) {
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    let pulse = sin(phase * .pi)
    let pieces = 24
    for idx in 0..<pieces {
        let seed = CGFloat(idx) / CGFloat(max(1, pieces - 1))
        let x = rect.minX + 30 + rect.width * seed
        let drift = sin((seed * 8 + phase * 6) * .pi) * 26
        let fall = rect.maxY - (rect.height * (0.18 + seed * 0.52)) + pulse * 28
        let size = 10 + CGFloat((idx % 4) * 4)
        let confettiRect = CGRect(x: x + drift, y: fall, width: size, height: size * 0.55)
        let color = idx.isMultiple(of: 2) ? start.withAlphaComponent(0.7) : end.withAlphaComponent(0.8)
        ctx.saveGState()
        ctx.translateBy(x: confettiRect.midX, y: confettiRect.midY)
        ctx.rotate(by: seed * .pi + phase * .pi * 1.2)
        ctx.setFillColor(color.cgColor)
        ctx.fill(CGRect(x: -confettiRect.width / 2, y: -confettiRect.height / 2, width: confettiRect.width, height: confettiRect.height))
        ctx.restoreGState()
    }
    ctx.restoreGState()
}

func drawSirenPulse(in ctx: CGContext, rect: CGRect, color: NSColor, phase: CGFloat) {
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    let pulse = 0.35 + 0.65 * abs(sin(phase * .pi * 1.8))
    let center = CGPoint(x: rect.midX, y: rect.midY + 8)
    for ring in 0..<4 {
        let radius = rect.width * (0.10 + CGFloat(ring) * 0.09 + pulse * 0.03)
        ctx.setStrokeColor(color.withAlphaComponent(max(0.08, 0.28 - CGFloat(ring) * 0.06)).cgColor)
        ctx.setLineWidth(6 - CGFloat(ring))
        ctx.strokeEllipse(in: CGRect(x: center.x - radius, y: center.y - radius * 0.56, width: radius * 2, height: radius * 1.12))
    }
    let beamWidth: CGFloat = 220
    let beamAlpha = 0.08 + pulse * 0.12
    let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
            color.withAlphaComponent(0).cgColor,
            color.withAlphaComponent(beamAlpha).cgColor,
            color.withAlphaComponent(0).cgColor
        ] as CFArray,
        locations: [0, 0.5, 1]
    )!
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: center.x - beamWidth, y: center.y + 90),
        end: CGPoint(x: center.x + beamWidth, y: center.y + 90),
        options: []
    )
    ctx.restoreGState()
}

func drawSafeShield(in ctx: CGContext, rect: CGRect, start: NSColor, end: NSColor, phase: CGFloat) {
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    let pulse = 0.4 + 0.6 * sin(phase * .pi)
    let shieldRect = CGRect(x: rect.midX - 92, y: rect.midY - 74, width: 184, height: 184)
    let shield = CGMutablePath()
    shield.move(to: CGPoint(x: shieldRect.midX, y: shieldRect.maxY))
    shield.addLine(to: CGPoint(x: shieldRect.maxX, y: shieldRect.maxY - 30))
    shield.addLine(to: CGPoint(x: shieldRect.maxX - 18, y: shieldRect.midY - 10))
    shield.addQuadCurve(to: CGPoint(x: shieldRect.midX, y: shieldRect.minY), control: CGPoint(x: shieldRect.maxX - 18, y: shieldRect.minY + 26))
    shield.addQuadCurve(to: CGPoint(x: shieldRect.minX + 18, y: shieldRect.midY - 10), control: CGPoint(x: shieldRect.minX + 18, y: shieldRect.minY + 26))
    shield.addLine(to: CGPoint(x: shieldRect.minX, y: shieldRect.maxY - 30))
    shield.closeSubpath()
    ctx.addPath(shield)
    ctx.setStrokeColor(end.withAlphaComponent(0.55 + pulse * 0.15).cgColor)
    ctx.setLineWidth(7)
    ctx.strokePath()
    for ring in 0..<3 {
        let radius = 120 + CGFloat(ring) * 34 + pulse * 18
        ctx.setStrokeColor(end.withAlphaComponent(0.12 - CGFloat(ring) * 0.03).cgColor)
        ctx.setLineWidth(3)
        ctx.strokeEllipse(in: CGRect(x: rect.midX - radius, y: rect.midY - radius * 0.55, width: radius * 2, height: radius * 1.1))
    }
    ctx.restoreGState()
}

func drawLossWarning(in ctx: CGContext, rect: CGRect, color: NSColor, phase: CGFloat) {
    let flicker = phase < 0.18 || (phase > 0.52 && phase < 0.72) ? 1.0 : 0.45
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()

    ctx.setLineWidth(14)
    for idx in -3...8 {
        let startX = rect.minX + CGFloat(idx) * 120
        ctx.setStrokeColor(color.withAlphaComponent(0.10 * flicker).cgColor)
        ctx.move(to: CGPoint(x: startX, y: rect.minY))
        ctx.addLine(to: CGPoint(x: startX + 180, y: rect.maxY))
    }
    ctx.strokePath()

    let warnRect = CGRect(x: rect.midX - 210, y: rect.midY - 86, width: 420, height: 132)
    let path = CGPath(roundedRect: warnRect, cornerWidth: 28, cornerHeight: 28, transform: nil)
    ctx.addPath(path)
    ctx.setStrokeColor(color.withAlphaComponent(0.28 + 0.18 * flicker).cgColor)
    ctx.setLineWidth(3)
    ctx.strokePath()
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

    let titleBlockWidth: CGFloat = 940
    let titleBlockX: CGFloat = (width - titleBlockWidth) / 2
    let titleCenterY: CGFloat = height * 0.64
    let titleRect = NSRect(x: titleBlockX, y: titleCenterY - 40, width: titleBlockWidth, height: 110)
    let titleHaloRect = NSRect(x: titleBlockX - 180, y: titleCenterY - 160, width: titleBlockWidth + 360, height: 320)
    let titleHalo = NSGradient(colors: [
        config.edgeGlow.withAlphaComponent(0.18 + (0.12 * pulse)),
        config.edgeGlow.withAlphaComponent(0.04 + (0.03 * pulse)),
        config.edgeGlow.withAlphaComponent(0.0)
    ])!
    titleHalo.draw(in: titleHaloRect, relativeCenterPosition: NSPoint(x: 0.0, y: 0.25))
    let titleMotionRect = NSRect(x: titleBlockX - 80, y: titleCenterY - 96, width: titleBlockWidth + 160, height: 192)
    switch config.motionStyle {
    case .siren:
        drawSirenPulse(in: ctx, rect: titleMotionRect, color: config.edgeGlow, phase: phase)
        drawTitleShimmer(in: ctx, rect: titleMotionRect, color: config.edgeGlow, phase: phase)
        drawSignalSweep(in: ctx, rect: titleMotionRect, color: config.accentEnd, phase: phase)
    case .confetti:
        drawConfetti(in: ctx, rect: titleMotionRect, start: config.accentStart, end: config.accentEnd, phase: phase)
        drawTitleShimmer(in: ctx, rect: titleMotionRect, color: config.edgeGlow.withAlphaComponent(0.8), phase: phase)
    case .warn:
        drawLossWarning(in: ctx, rect: titleMotionRect, color: config.edgeGlow, phase: phase)
        drawTitleShimmer(in: ctx, rect: titleMotionRect, color: config.edgeGlow.withAlphaComponent(0.7), phase: phase)
    case .safe:
        drawSafeShield(in: ctx, rect: titleMotionRect, start: config.accentStart, end: config.accentEnd, phase: phase)
        drawTitleShimmer(in: ctx, rect: titleMotionRect, color: config.edgeGlow.withAlphaComponent(0.72), phase: phase)
    }
    drawText(
        config.title,
        in: titleRect.offsetBy(dx: 0, dy: 0),
        font: NSFont.systemFont(ofSize: 96, weight: .black),
        color: config.edgeGlow.withAlphaComponent(0.18 + (0.12 * pulse)),
        alignment: .center
    )
    drawText(
        config.title,
        in: titleRect,
        font: NSFont.systemFont(ofSize: 96, weight: .black),
        color: NSColor(calibratedWhite: 0.985, alpha: 1),
        alignment: .center
    )
    drawText(
        config.subtitle,
        in: NSRect(x: titleBlockX, y: titleCenterY - 84, width: titleBlockWidth, height: 48),
        font: NSFont(name: "Snell Roundhand Bold", size: 40) ?? NSFont.systemFont(ofSize: 40, weight: .semibold),
        color: config.accentStart.blended(withFraction: 0.25 * pulse, of: .white) ?? config.accentStart,
        alignment: .center
    )

    let subtitleLine = NSRect(x: titleBlockX + 120, y: titleCenterY - 98, width: titleBlockWidth - 240, height: 4)
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
