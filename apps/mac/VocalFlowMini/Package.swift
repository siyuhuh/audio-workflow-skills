// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "VocalFlowMini",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "VocalFlow", targets: ["VocalFlowMini"])
    ],
    targets: [
        .executableTarget(
            name: "VocalFlowMini",
            path: "VocalFlowMini",
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "VocalFlowMini/Info.plist"
                ])
            ]
        )
    ]
)
