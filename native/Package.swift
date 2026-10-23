// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "XenolauncherNative",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "Xenolauncher", targets: ["Xenolauncher"])],
    targets: [
        .executableTarget(
            name: "Xenolauncher", path: ".",
            exclude: ["scripts", "README.md", "dist"],
            sources: ["Sources"], resources: [.copy("Backend"), .copy("Resources/AppIcon.icns"), .copy("Translations")]
        )
    ]
)
