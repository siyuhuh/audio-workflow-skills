import Foundation

@MainActor
final class RemoteAgentStatusService: ObservableObject {
    struct RemoteJobSummary: Decodable, Identifiable {
        let id: String
        let title: String
        let status: String
        let stage: String
        let overallProgress: Double
        let message: String

        var isActive: Bool { status == "queued" || status == "running" }
    }

    private struct AgentConfig: Decodable {
        let name: String
        let token: String
        let pairingCode: String
    }

    private struct JobsEnvelope: Decodable {
        let jobs: [RemoteJobSummary]
    }

    @Published private(set) var name = "VocalFlow on Mac mini"
    @Published private(set) var pairingCode = "------"
    @Published private(set) var isOnline = false
    @Published private(set) var isInstalling = false
    @Published private(set) var jobs: [RemoteJobSummary] = []
    @Published private(set) var statusMessage = "Checking private agent…"

    let localURL = "http://\(RemoteAgentStatusService.localHostName()):8766"
    @Published private(set) var tailscaleURL = "Not configured"
    let outputDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Movies/VocalFlow/Remote", isDirectory: true)
    let logFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/VocalFlow/agent.log")

    private let configURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/VocalFlow/Agent/config.json")
    private let decoder = JSONDecoder()

    func refresh() {
        Task {
            tailscaleURL = await Self.detectTailscaleURL() ?? "Not configured"
        }
        guard let data = try? Data(contentsOf: configURL),
              let config = try? decoder.decode(AgentConfig.self, from: data) else {
            isOnline = false
            pairingCode = "------"
            jobs = []
            statusMessage = "Agent is not installed yet."
            return
        }

        name = config.name
        pairingCode = config.pairingCode
        statusMessage = "Connecting to the local agent…"
        Task { await loadJobs(token: config.token) }
    }

    func installBundledAgent() {
        guard !isInstalling else { return }
        guard let installerURL = Bundle.main.resourceURL?
            .appendingPathComponent("agent", isDirectory: true)
            .appendingPathComponent("install-agent.sh"),
              FileManager.default.isExecutableFile(atPath: installerURL.path) else {
            statusMessage = "The Agent installer is not included in this development build."
            return
        }

        isInstalling = true
        statusMessage = "Installing the private Mac mini Agent…"
        Task {
            do {
                try await Self.runInstaller(installerURL)
                isInstalling = false
                statusMessage = "Agent installed. Connecting…"
                refresh()
            } catch {
                isInstalling = false
                isOnline = false
                statusMessage = error.localizedDescription
            }
        }
    }

    private func loadJobs(token: String) async {
        guard let url = URL(string: "http://127.0.0.1:8766/v1/jobs") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
                throw URLError(.badServerResponse)
            }
            jobs = try decoder.decode(JobsEnvelope.self, from: data).jobs
            isOnline = true
            let activeCount = jobs.filter(\.isActive).count
            statusMessage = activeCount == 0 ? "Ready for iPhone requests." : "\(activeCount) remote job(s) active."
        } catch {
            isOnline = false
            jobs = []
            statusMessage = "Agent is installed but not responding on port 8766."
        }
    }

    nonisolated private static func runInstaller(_ installerURL: URL) async throws {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            process.arguments = [installerURL.path]
            let errorPipe = Pipe()
            process.standardOutput = Pipe()
            process.standardError = errorPipe
            process.terminationHandler = { process in
                if process.terminationStatus == 0 {
                    continuation.resume()
                    return
                }
                let data = errorPipe.fileHandleForReading.readDataToEndOfFile()
                let detail = String(data: data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(
                    throwing: AgentInstallError.failed(
                        detail?.isEmpty == false ? detail! : "Agent installer exited with code \(process.terminationStatus)."
                    )
                )
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    nonisolated private static func localHostName() -> String {
        let raw = ProcessInfo.processInfo.hostName
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        if raw.lowercased().hasSuffix(".local") {
            return raw
        }
        let label = raw.split(separator: ".").first.map(String.init) ?? "vocalflow-mac"
        return "\(label).local"
    }

    nonisolated private static func detectTailscaleURL() async -> String? {
        let candidates = [
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale"
        ]
        guard let executable = candidates.first(where: {
            FileManager.default.isExecutableFile(atPath: $0)
        }) else {
            return nil
        }

        return await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["status", "--json"]
            let output = Pipe()
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            process.terminationHandler = { process in
                guard process.terminationStatus == 0 else {
                    continuation.resume(returning: nil)
                    return
                }
                let data = output.fileHandleForReading.readDataToEndOfFile()
                guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let selfStatus = object["Self"] as? [String: Any],
                      let dnsName = selfStatus["DNSName"] as? String else {
                    continuation.resume(returning: nil)
                    return
                }
                let host = dnsName.trimmingCharacters(in: CharacterSet(charactersIn: "."))
                continuation.resume(returning: host.isEmpty ? nil : "https://\(host)")
            }
            do {
                try process.run()
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }
}

private enum AgentInstallError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let detail):
            "Could not install the private Agent. \(detail)"
        }
    }
}
