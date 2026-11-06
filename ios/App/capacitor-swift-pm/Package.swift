// swift-tools-version:5.3
import PackageDescription

// Takes over the identity "capacitor-swift-pm" from the remote package that
// CapApp-SPM and @capacitor/haptics name, so every Capacitor import in the
// project resolves here. The remote package's binaries have no Mac Catalyst
// slice; these have it and keep the official iOS and Simulator slices. The
// xcframeworks are generated, not committed:
//   ios/mac-catalyst/build-capacitor-xcframeworks.sh
let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    dependencies: [],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Cordova.xcframework")
    ]
)
