import Foundation

enum KaraokePackageScanner {
    static let manifestFileName = "vocalflow-package.json"

    static func readManifest(in folderURL: URL) throws -> KaraokePackage {
        let manifestURL = folderURL.appendingPathComponent(manifestFileName)
        let data = try Data(contentsOf: manifestURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(KaraokePackage.self, from: data)
    }

    static func scanExistingPackageFolder(_ folderURL: URL) throws -> KaraokePackage {
        if FileManager.default.fileExists(atPath: folderURL.appendingPathComponent(manifestFileName).path) {
            return try readManifest(in: folderURL)
        }

        let package = try scan(
            outputDirectory: folderURL,
            source: .localFile(folderURL),
            options: ProcessingOptions()
        )

        guard package.playback.mediaURL != nil || package.playback.videoURL != nil else {
            throw KaraokePackageScannerError.noPlayableMedia(folderURL.path)
        }

        try writeManifest(package)
        return package
    }

    static func discoverManifestFolders(in rootURL: URL) -> [URL] {
        guard FileManager.default.fileExists(atPath: rootURL.path),
              let enumerator = FileManager.default.enumerator(
                  at: rootURL,
                  includingPropertiesForKeys: [.isRegularFileKey],
                  options: [.skipsHiddenFiles]
              ) else {
            return []
        }

        var folders: [URL] = []
        for case let fileURL as URL in enumerator where fileURL.lastPathComponent == manifestFileName {
            folders.append(fileURL.deletingLastPathComponent())
        }

        return folders.sorted {
            $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending
        }
    }

    static func scan(
        outputDirectory: URL,
        source: KaraokeSource,
        options: ProcessingOptions,
        stdout: String = ""
    ) throws -> KaraokePackage {
        let assets = discoverAssets(in: outputDirectory)
        let playback = buildPlaybackBundle(from: assets)
        let title = cleanTrackTitle(
            from: playback.originalURL ?? playback.backingURL ?? playback.mediaURL ?? playback.videoURL,
            fallback: source.suggestedTitle
        )

        return KaraokePackage(
            id: UUID(),
            title: title,
            folderURL: outputDirectory,
            source: source,
            options: options,
            assets: assets,
            playback: playback,
            createdAt: Date()
        )
    }

    static func writeManifest(_ package: KaraokePackage) throws {
        let manifestURL = package.folderURL.appendingPathComponent(manifestFileName)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(package)
        try data.write(to: manifestURL, options: .atomic)
    }

    private static func discoverAssets(in outputDirectory: URL) -> [PackageAsset] {
        guard let enumerator = FileManager.default.enumerator(
            at: outputDirectory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        var assets: [PackageAsset] = []
        for case let fileURL as URL in enumerator {
            if fileURL.lastPathComponent == manifestFileName {
                continue
            }
            let role = classify(fileURL)
            if role == .vocalStem {
                continue
            }
            assets.append(PackageAsset(url: fileURL, role: role))
        }

        return assets.sorted {
            if $0.role.rawValue == $1.role.rawValue {
                return $0.url.lastPathComponent.localizedCaseInsensitiveCompare($1.url.lastPathComponent) == .orderedAscending
            }
            return priority($0.role) < priority($1.role)
        }
    }

    private static func buildPlaybackBundle(from assets: [PackageAsset]) -> PlaybackBundle {
        let video = firstAsset(in: assets, roles: [.videoPreview])
        let backing = firstAsset(in: assets, roles: [.backingStem])
        let original = firstAsset(in: assets, roles: [.originalAudio])
        let vocal = firstAsset(in: assets, roles: [.vocalStem])
        let lyrics = firstAsset(in: assets, roles: [.lyrics, .jsonTiming, .subtitle])

        return PlaybackBundle(
            mediaURL: backing ?? original ?? video,
            videoURL: video,
            lyricURL: lyrics,
            originalURL: original,
            backingURL: backing,
            vocalURL: vocal
        )
    }

    private static func firstAsset(in assets: [PackageAsset], roles: [PackageAssetRole]) -> URL? {
        for role in roles {
            if let asset = assets.first(where: { $0.role == role }) {
                return asset.url
            }
        }
        return nil
    }

    private static func classify(_ url: URL) -> PackageAssetRole {
        let ext = url.pathExtension.lowercased()
        let name = url.deletingPathExtension().lastPathComponent.lowercased()
        let path = url.path.lowercased()

        if name.contains("preview"), ["mp4", "mov", "m4v"].contains(ext) {
            return .videoPreview
        }
        if ext == "lrc" {
            return .lyrics
        }
        if ext == "json" {
            return .jsonTiming
        }
        if ext == "srt" || ext == "vtt" {
            return .subtitle
        }
        if ext == "ass" {
            return .assKaraoke
        }
        if ["mp3", "m4a", "wav", "flac", "aac"].contains(ext) {
            let looksLikeStem = path.contains("/stems/") || path.contains("\\stems\\")
            if looksLikeStem || name.contains("instrumental") || name.contains("vocals") || name.contains("vocal") || name.contains("no_vocals") || name.contains("no-vocals") || name.contains("backing") {
                if name.contains("instrumental") || name.contains("no_vocals") || name.contains("no-vocals") || name.contains("backing") {
                    return .backingStem
                }
                if name.contains("vocals") || name.contains("vocal") || name.contains("voice") || name.contains("acapella") {
                    return .vocalStem
                }
            }
            if name.contains("transcribe") {
                return .originalAudio
            }
            return .originalAudio
        }
        if ["mp4", "mov", "m4v"].contains(ext) {
            return .videoPreview
        }

        return .other
    }

    private static func priority(_ role: PackageAssetRole) -> Int {
        switch role {
        case .videoPreview:
            return 0
        case .backingStem:
            return 1
        case .originalAudio:
            return 2
        case .vocalStem:
            return 3
        case .lyrics:
            return 4
        case .jsonTiming:
            return 5
        case .subtitle:
            return 6
        case .assKaraoke:
            return 7
        case .other:
            return 9
        }
    }

    private static func cleanTrackTitle(from url: URL?, fallback: String) -> String {
        let rawTitle = url?.deletingPathExtension().lastPathComponent.nonEmpty ?? fallback
        return cleanTrackTitle(rawTitle)
    }

    private static func cleanTrackTitle(_ title: String) -> String {
        var cleaned = title
        let patterns = [
            #"(?i)_?\((?:instrumental|vocals?|voice|acapella)\).*"#,
            #"(?i)[_\s-]+(?:instrumental|vocals?|voice|acapella|no[_\s-]?vocals?|backing|transcribe)(?:[_\s-].*)?$"#
        ]

        for pattern in patterns {
            cleaned = cleaned.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
        }

        return cleaned.trimmingCharacters(in: CharacterSet(charactersIn: " _-")).nonEmpty ?? title
    }
}

enum KaraokePackageScannerError: LocalizedError {
    case noPlayableMedia(String)

    var errorDescription: String? {
        switch self {
        case .noPlayableMedia(let path):
            return "No playable audio or video files were found in \(path)."
        }
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
