import Foundation

@MainActor
final class KaraokeLibrary: ObservableObject {
    @Published private(set) var packages: [MobileKaraokePackage] = []
    @Published private(set) var isImporting = false
    @Published var message: String?

    private let fileManager = FileManager.default

    init() {
        reload()
    }

    func reload() {
        let root = libraryRoot
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
        let folders = (try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey, .creationDateKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        packages = folders.compactMap { folder in
            guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return nil }
            let createdAt = (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date()
            return try? KaraokePackageScanner.scan(folder, fallbackDate: createdAt)
        }
        .sorted { $0.importedAt > $1.importedAt }
    }

    func importFolder(_ sourceURL: URL) {
        guard !isImporting else { return }
        isImporting = true
        message = nil
        let root = libraryRoot

        Task {
            do {
                let destination = try await Task.detached(priority: .userInitiated) {
                    let didAccess = sourceURL.startAccessingSecurityScopedResource()
                    defer {
                        if didAccess { sourceURL.stopAccessingSecurityScopedResource() }
                    }

                    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                    let baseName = sourceURL.lastPathComponent.sanitizedFileName.nonEmpty ?? "Karaoke"
                    let folderName = "\(baseName)-\(UUID().uuidString.prefix(8))"
                    let destination = root.appendingPathComponent(folderName, isDirectory: true)
                    try FileManager.default.copyItem(at: sourceURL, to: destination)
                    _ = try KaraokePackageScanner.scan(destination)
                    return destination
                }.value

                reload()
                message = "已导入 \(destination.lastPathComponent)"
            } catch {
                message = error.localizedDescription
            }
            isImporting = false
        }
    }

    func delete(_ package: MobileKaraokePackage) {
        do {
            try fileManager.removeItem(at: package.folderURL)
            reload()
        } catch {
            message = error.localizedDescription
        }
    }

    func makeRemotePackageDirectory(title: String, jobID: String) throws -> URL {
        try fileManager.createDirectory(at: libraryRoot, withIntermediateDirectories: true)
        let name = title.sanitizedFileName.nonEmpty ?? "Remote-Karaoke"
        let destination = libraryRoot.appendingPathComponent("\(name)-\(jobID)", isDirectory: true)
        guard !fileManager.fileExists(atPath: destination.path) else {
            throw RemoteAgentError.server("这首歌已经下载到 iPhone。")
        }
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        return destination
    }

    func existingRemotePackage(jobID: String) -> MobileKaraokePackage? {
        packages.first { $0.folderURL.lastPathComponent.hasSuffix("-\(jobID)") }
    }

    func completeRemoteImport(at folderURL: URL) throws -> MobileKaraokePackage {
        let package = try KaraokePackageScanner.scan(folderURL)
        reload()
        message = "已从 Mac mini 下载 \(package.title)"
        return package
    }

    private var libraryRoot: URL {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("KaraokePackages", isDirectory: true)
    }
}

private extension String {
    var sanitizedFileName: String {
        let invalid = CharacterSet(charactersIn: "/:\\?%*|\"<>")
        return components(separatedBy: invalid).joined(separator: "-")
    }

    var nonEmpty: String? { isEmpty ? nil : self }
}
