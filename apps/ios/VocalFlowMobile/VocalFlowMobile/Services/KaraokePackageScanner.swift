import Foundation

enum KaraokePackageScanner {
    static let manifestFileName = "vocalflow-package.json"
    static let electronManifestFileName = "manifest.json"

    private struct LooseManifest: Decodable {
        let title: String?
        let createdAt: String?

        var parsedCreatedAt: Date? {
            Self.fractionalFormatter.date(from: createdAt ?? "")
                ?? ISO8601DateFormatter().date(from: createdAt ?? "")
        }

        private static let fractionalFormatter: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()
    }

    static func scan(_ folderURL: URL, fallbackDate: Date = Date()) throws -> MobileKaraokePackage {
        let files = discoverFiles(in: folderURL)
        let manifest = readManifest(in: folderURL)
        let video = preferredVideo(in: files)
        let backing = files.first(where: isBackingAudio)
        let vocal = files.first(where: isVocalAudio)
        let primaryAudio = files.first { url in
            isAudio(url) && !isBackingAudio(url) && !isVocalAudio(url)
        }
        let lyric = preferredLyrics(in: files)
        let title = manifest?.title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            ?? cleanTitle(from: primaryAudio ?? vocal ?? backing ?? video ?? folderURL)

        guard video != nil || primaryAudio != nil || vocal != nil || backing != nil else {
            throw PackageScannerError.noPlayableMedia
        }

        return MobileKaraokePackage(
            id: stableUUID(for: folderURL),
            title: title,
            folderURL: folderURL,
            importedAt: manifest?.parsedCreatedAt ?? fallbackDate,
            videoURL: video,
            primaryAudioURL: primaryAudio,
            backingURL: backing,
            vocalURL: vocal,
            lyricURL: lyric
        )
    }

    private static func discoverFiles(in folderURL: URL) -> [URL] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .contentModificationDateKey]
        guard let enumerator = FileManager.default.enumerator(
            at: folderURL,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }

        return enumerator.compactMap { item -> URL? in
            guard let url = item as? URL,
                  (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
                return nil
            }
            return url
        }
        .sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }

    private static func readManifest(in folderURL: URL) -> LooseManifest? {
        let decoder = JSONDecoder()
        for name in [manifestFileName, electronManifestFileName] {
            let url = folderURL.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: url) else { continue }
            if let manifest = try? decoder.decode(LooseManifest.self, from: data) {
                return manifest
            }
        }
        return nil
    }

    private static func preferredVideo(in files: [URL]) -> URL? {
        let videos = files.filter(isVideo)
        return videos.first(where: { normalizedName($0).contains("preview") }) ?? videos.first
    }

    private static func preferredLyrics(in files: [URL]) -> URL? {
        for ext in ["json", "lrc", "srt"] {
            if let result = files.first(where: {
                $0.pathExtension.lowercased() == ext &&
                    ![manifestFileName, electronManifestFileName, "recording.json"].contains($0.lastPathComponent)
            }) {
                return result
            }
        }
        return nil
    }

    private static func isAudio(_ url: URL) -> Bool {
        ["mp3", "m4a", "wav", "aac", "aiff", "caf", "flac"].contains(url.pathExtension.lowercased())
    }

    private static func isVideo(_ url: URL) -> Bool {
        ["mp4", "mov", "m4v"].contains(url.pathExtension.lowercased())
    }

    private static func isBackingAudio(_ url: URL) -> Bool {
        guard isAudio(url) else { return false }
        let name = normalizedName(url)
        return name.contains("instrumental") || name.contains("no_vocals") || name.contains("no-vocals") || name.contains("backing")
    }

    private static func isVocalAudio(_ url: URL) -> Bool {
        guard isAudio(url), !isBackingAudio(url) else { return false }
        let name = normalizedName(url)
        return name.contains("vocals") || name.contains("vocal") || name.contains("voice") || name.contains("acapella")
    }

    private static func normalizedName(_ url: URL) -> String {
        url.deletingPathExtension().lastPathComponent.lowercased()
    }

    private static func cleanTitle(from url: URL) -> String {
        var result = url.deletingPathExtension().lastPathComponent
        let patterns = [
            #"(?i)_?\((?:instrumental|vocals?|voice|acapella)\).*"#,
            #"(?i)[_\s-]+(?:instrumental|vocals?|voice|acapella|no[_\s-]?vocals?|backing|transcribe)(?:[_\s-].*)?$"#
        ]
        for pattern in patterns {
            result = result.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
        }
        return result.trimmingCharacters(in: CharacterSet(charactersIn: " _-")).nonEmpty ?? "Untitled song"
    }

    private static func stableUUID(for url: URL) -> UUID {
        var bytes = Array(url.lastPathComponent.utf8.prefix(16))
        bytes.append(contentsOf: repeatElement(0, count: max(0, 16 - bytes.count)))
        bytes[6] = (bytes[6] & 0x0F) | 0x40
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}

enum PackageScannerError: LocalizedError {
    case noPlayableMedia

    var errorDescription: String? {
        "这个文件夹里没有可播放的 MV 或音频。"
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
