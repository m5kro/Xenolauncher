#!/usr/bin/env swift
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Keep the original logo intact, replace its circular black background with a
// black squircle, and add transparent padding for the legacy .icns pipeline.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = root.appendingPathComponent("icon.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let artwork = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Cannot read \(sourceURL.path)")
}
let files = FileManager.default
let temporary = files.temporaryDirectory.appendingPathComponent("Xenolauncher-icon-\(UUID().uuidString)")
let iconset = temporary.appendingPathComponent("AppIcon.iconset")
try files.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? files.removeItem(at: temporary) }

func render(size: Int, to url: URL) throws {
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: size * 4, space: colorSpace,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    // 824 px artwork on a 1024 px canvas: a visual sizing choice, not a
    // platform-mandated inset. Preserve the source's aspect ratio and margins.
    let scale = Double(size) * (824.0 / 1024.0) / Double(max(artwork.width, artwork.height))
    let width = Double(artwork.width) * scale
    let height = Double(artwork.height) * scale
    let artworkRect = CGRect(x: (Double(size) - width) / 2,
                             y: (Double(size) - height) / 2,
                             width: width, height: height)
    // A smooth superellipse supplies the rounded-square silhouette. Fill behind
    // the source with the same black, so its circular edge disappears without
    // tracing, cropping, or redrawing the white logo.
    let background = CGMutablePath()
    let halfSide = Double(size) * (824.0 / 1024.0) / 2
    let center = Double(size) / 2
    for step in 0..<1024 {
        let angle = Double(step) * 2 * .pi / 1024
        let cosine = cos(angle), sine = sin(angle)
        let x = center + halfSide * (cosine < 0 ? -1 : 1) * pow(abs(cosine), 0.4)
        let y = center + halfSide * (sine < 0 ? -1 : 1) * pow(abs(sine), 0.4)
        if step == 0 { background.move(to: CGPoint(x: x, y: y)) }
        else { background.addLine(to: CGPoint(x: x, y: y)) }
    }
    background.closeSubpath()
    context.addPath(background)
    context.clip()
    context.setFillColor(CGColor(gray: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    context.draw(artwork, in: artworkRect)
    let image = context.makeImage()!
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot write \(url.path)") }
}

for points in [16, 32, 128, 256, 512] {
    for density in [1, 2] {
        let suffix = density == 2 ? "@2x" : ""
        try render(size: points * density,
                   to: iconset.appendingPathComponent("icon_\(points)x\(points)\(suffix).png"))
    }
}
let icon = root.appendingPathComponent("app/app.icns")
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", icon.path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed") }
let nativeIcon = root.appendingPathComponent("native/Resources/AppIcon.icns")
try files.createDirectory(at: nativeIcon.deletingLastPathComponent(), withIntermediateDirectories: true)
try Data(contentsOf: icon).write(to: nativeIcon, options: .atomic)
let preview = root.appendingPathComponent("app/icon.png")
// Replace only generated output; icon.png at the repository root is untouched.
try Data(contentsOf: iconset.appendingPathComponent("icon_512x512@2x.png")).write(to: preview, options: .atomic)
print("Generated \(icon.path), \(nativeIcon.path), and \(preview.path)")
