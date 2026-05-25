import AppKit
import Foundation

@MainActor
final class PackageLibraryService: ObservableObject {
    enum PackageAvailability: Equatable {
        case ready
        case missingFolder
        case missingMedia

        var label: String {
            switch self {
            case .ready:
                return "Ready"
            case .missingFolder:
                return "Missing folder"
            case .missingMedia:
                return "Missing media"
            }
        }
    }

    @Published private(set) var packages: [KaraokePackage] = []
    @Published private(set) var status = "Library ready."
    @Published private(set) var lastError: String?

    private let storeURL: URL

    init(storeURL: URL = PackageLibraryService.defaultStoreURL()) {
        self.storeURL = storeURL
        loadFromDisk()
        refresh()
    }

    func refresh() {
        lastError = nil
        var merged = packages

        for rootURL in scanRoots() {
            for package in discoverPackages(in: rootURL) {
                upsert(package, into: &merged)
            }
        }

        packages = sort(merged)
        saveToDisk()
        status = packages.isEmpty ? "No songs indexed yet." : "Indexed \(packages.count) package\(packages.count == 1 ? "" : "s")."
    }

    func addPackage(_ package: KaraokePackage) {
        lastError = nil
        var merged = packages
        upsert(package, into: &merged)
        packages = sort(merged)
        saveToDisk()
        status = "Added \(package.title)."
    }

    func choosePackageFolder() {
        let panel = NSOpenPanel()
        panel.title = "Import a VocalFlow or LALAL.AI output folder"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        importPackageFolder(url)
    }

    func importPackageFolder(_ folderURL: URL) {
        do {
            let package = try KaraokePackageScanner.scanExistingPackageFolder(folderURL)
            addPackage(package)
            status = "Imported \(package.title)."
        } catch {
            lastError = error.localizedDescription
            status = "Import failed."
        }
    }

    func removePackage(_ package: KaraokePackage) {
        packages.removeAll { sameStoredPackage($0, package) }
        saveToDisk()
        status = "Removed \(package.title) from Library."
    }

    func revealPackage(_ package: KaraokePackage) {
        NSWorkspace.shared.activateFileViewerSelecting([package.folderURL])
    }

    func availability(for package: KaraokePackage) -> PackageAvailability {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: package.folderURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            return .missingFolder
        }

        if let mediaURL = package.playback.mediaURL ?? package.playback.videoURL,
           FileManager.default.fileExists(atPath: mediaURL.path) {
            return .ready
        }

        if hasPlayableMedia(in: package.folderURL) {
            return .ready
        }

        return .missingMedia
    }

    private func scanRoots() -> [URL] {
        var roots = [PackageCreationService.defaultOutputRoot()]
        roots.append(contentsOf: packages.map(\.folderURL))
        return uniqueURLs(roots)
    }

    private func discoverPackages(in rootURL: URL) -> [KaraokePackage] {
        if let package = try? KaraokePackageScanner.readManifest(in: rootURL) {
            return [package]
        }

        return KaraokePackageScanner.discoverManifestFolders(in: rootURL).compactMap { folderURL in
            try? KaraokePackageScanner.readManifest(in: folderURL)
        }
    }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: storeURL) else {
            packages = []
            return
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        packages = (try? decoder.decode([KaraokePackage].self, from: data)) ?? []
    }

    private func saveToDisk() {
        do {
            try FileManager.default.createDirectory(
                at: storeURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(packages)
            try data.write(to: storeURL, options: .atomic)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func upsert(_ package: KaraokePackage, into packages: inout [KaraokePackage]) {
        if let index = packages.firstIndex(where: { sameStoredPackage($0, package) }) {
            packages[index] = package
        } else {
            packages.append(package)
        }
    }

    private func sameStoredPackage(_ lhs: KaraokePackage, _ rhs: KaraokePackage) -> Bool {
        lhs.id == rhs.id || lhs.folderURL.standardizedFileURL.path == rhs.folderURL.standardizedFileURL.path
    }

    private func sort(_ packages: [KaraokePackage]) -> [KaraokePackage] {
        packages.sorted { lhs, rhs in
            lhs.createdAt > rhs.createdAt
        }
    }

    private func uniqueURLs(_ urls: [URL]) -> [URL] {
        var seen: Set<String> = []
        var unique: [URL] = []

        for url in urls {
            let path = url.standardizedFileURL.path
            if seen.insert(path).inserted {
                unique.append(url)
            }
        }

        return unique
    }

    private func hasPlayableMedia(in folderURL: URL) -> Bool {
        guard let enumerator = FileManager.default.enumerator(
            at: folderURL,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        let extensions = Set(["mp3", "m4a", "wav", "flac", "aac", "mp4", "mov", "m4v"])
        for case let fileURL as URL in enumerator where extensions.contains(fileURL.pathExtension.lowercased()) {
            return true
        }

        return false
    }

    nonisolated private static func defaultStoreURL() -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support", isDirectory: true)

        return appSupport
            .appendingPathComponent("VocalFlow Mini", isDirectory: true)
            .appendingPathComponent("library.json")
    }
}
