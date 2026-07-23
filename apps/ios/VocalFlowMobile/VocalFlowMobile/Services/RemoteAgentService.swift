import Foundation

@MainActor
final class RemoteAgentService: ObservableObject {
    @Published var baseURLText: String
    @Published private(set) var pairedName: String
    @Published private(set) var isConnected = false
    @Published private(set) var isPairing = false
    @Published private(set) var isSubmitting = false
    @Published private(set) var jobs: [RemoteJob] = []
    @Published private(set) var downloadingJobID: String?
    @Published private(set) var downloadProgress: Double = 0
    @Published var message: String?

    private let defaults = UserDefaults.standard
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let session: URLSession

    init() {
        baseURLText = UserDefaults.standard.string(forKey: "remoteAgent.baseURL")
            ?? ""
        pairedName = UserDefaults.standard.string(forKey: "remoteAgent.name") ?? "Mac mini"

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60 * 60
        configuration.waitsForConnectivity = true
        session = URLSession(configuration: configuration)
    }

    var isPaired: Bool {
        KeychainStore.readToken() != nil && normalizedBaseURL != nil
    }

    func useDiscoveredAgent(_ agent: DiscoveredAgent) {
        baseURLText = agent.baseURL
    }

    func switchEndpoint(to value: String) {
        baseURLText = value
        defaults.set(value, forKey: "remoteAgent.baseURL")
        isConnected = false
        Task { await refreshJobs(showErrors: true) }
    }

    func pair(code: String) async {
        guard !isPairing else { return }
        guard let baseURL = normalizedBaseURL else {
            message = RemoteAgentError.invalidURL.localizedDescription
            return
        }
        isPairing = true
        message = nil
        defer { isPairing = false }

        do {
            var request = URLRequest(url: endpoint("v1/pair", baseURL: baseURL))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(["code": code.trimmingCharacters(in: .whitespacesAndNewlines)])
            let data = try await perform(request)
            let response = try decoder.decode(RemotePairResponse.self, from: data)
            try KeychainStore.saveToken(response.token)
            defaults.set(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: "remoteAgent.baseURL")
            defaults.set(response.name, forKey: "remoteAgent.name")
            baseURLText = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            pairedName = response.name
            isConnected = true
            objectWillChange.send()
            await refreshJobs(showErrors: false)
        } catch {
            message = error.localizedDescription
            isConnected = false
        }
    }

    func disconnect() {
        KeychainStore.deleteToken()
        defaults.removeObject(forKey: "remoteAgent.name")
        pairedName = "Mac mini"
        jobs = []
        isConnected = false
        objectWillChange.send()
    }

    func submit(
        source: String,
        title: String,
        options: RemoteJobOptions
    ) async -> Bool {
        guard !isSubmitting else { return false }
        isSubmitting = true
        message = nil
        defer { isSubmitting = false }

        do {
            let body = CreateJobRequest(
                source: source.trimmingCharacters(in: .whitespacesAndNewlines),
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                options: options
            )
            var request = try authenticatedRequest(path: "v1/jobs")
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
            let data = try await perform(request)
            let job = try decoder.decode(RemoteJob.self, from: data)
            jobs.removeAll { $0.id == job.id }
            jobs.insert(job, at: 0)
            isConnected = true
            return true
        } catch {
            message = error.localizedDescription
            return false
        }
    }

    func refreshJobs(showErrors: Bool = true) async {
        guard isPaired else {
            isConnected = false
            return
        }
        do {
            let request = try authenticatedRequest(path: "v1/jobs")
            let data = try await perform(request)
            jobs = try decoder.decode(RemoteJobsEnvelope.self, from: data).jobs
            isConnected = true
        } catch {
            isConnected = false
            if showErrors { message = error.localizedDescription }
        }
    }

    func pollJobs() async {
        while !Task.isCancelled {
            await refreshJobs(showErrors: false)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    func cancel(_ job: RemoteJob) async {
        do {
            var request = try authenticatedRequest(path: "v1/jobs/\(job.id)/cancel")
            request.httpMethod = "POST"
            _ = try await perform(request)
            await refreshJobs(showErrors: false)
        } catch {
            message = error.localizedDescription
        }
    }

    func delete(_ job: RemoteJob) async {
        guard !job.isActive else { return }
        do {
            var request = try authenticatedRequest(path: "v1/jobs/\(job.id)")
            request.httpMethod = "DELETE"
            _ = try await perform(request)
            jobs.removeAll { $0.id == job.id }
        } catch {
            message = error.localizedDescription
        }
    }

    func downloadAndImport(
        _ job: RemoteJob,
        into library: KaraokeLibrary
    ) async -> MobileKaraokePackage? {
        guard job.isComplete, downloadingJobID == nil else { return nil }
        if let existing = library.existingRemotePackage(jobID: job.id) {
            return existing
        }
        downloadingJobID = job.id
        downloadProgress = 0
        message = nil

        var destination: URL?
        do {
            let folder = try library.makeRemotePackageDirectory(title: job.title, jobID: job.id)
            destination = folder
            let totalBytes = max(job.downloadableSize, 1)
            var completedBytes: Int64 = 0

            for file in job.files {
                let target = try safeDestination(for: file.path, inside: folder)
                try FileManager.default.createDirectory(
                    at: target.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                guard let baseURL = normalizedBaseURL,
                      let fileURL = URL(string: file.url, relativeTo: baseURL)?.absoluteURL else {
                    throw RemoteAgentError.invalidURL
                }
                var request = URLRequest(url: fileURL)
                request.setValue("Bearer \(try requiredToken())", forHTTPHeaderField: "Authorization")
                let (temporaryURL, response) = try await session.download(for: request)
                try validate(response: response, body: nil)
                try FileManager.default.moveItem(at: temporaryURL, to: target)
                completedBytes += file.size
                downloadProgress = min(1, Double(completedBytes) / Double(totalBytes))
            }

            let package = try library.completeRemoteImport(at: folder)
            downloadingJobID = nil
            downloadProgress = 1
            return package
        } catch {
            if let destination { try? FileManager.default.removeItem(at: destination) }
            downloadingJobID = nil
            downloadProgress = 0
            message = error.localizedDescription
            return nil
        }
    }

    private var normalizedBaseURL: URL? {
        var value = baseURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.contains("://") {
            value = "https://" + value
        }
        guard var components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil else {
            return nil
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private func authenticatedRequest(path: String) throws -> URLRequest {
        guard let baseURL = normalizedBaseURL else { throw RemoteAgentError.invalidURL }
        var request = URLRequest(url: endpoint(path, baseURL: baseURL))
        request.setValue("Bearer \(try requiredToken())", forHTTPHeaderField: "Authorization")
        return request
    }

    private func requiredToken() throws -> String {
        guard let token = KeychainStore.readToken() else {
            throw RemoteAgentError.server("请先与 Mac mini 配对。")
        }
        return token
    }

    private func endpoint(_ path: String, baseURL: URL) -> URL {
        path.split(separator: "/").reduce(baseURL) { partial, component in
            partial.appendingPathComponent(String(component), isDirectory: false)
        }
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        try validate(response: response, body: data)
        return data
    }

    private func validate(response: URLResponse, body: Data?) throws {
        guard let http = response as? HTTPURLResponse else {
            throw RemoteAgentError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            if let body,
               let envelope = try? decoder.decode(RemoteAgentErrorEnvelope.self, from: body) {
                throw RemoteAgentError.server(envelope.error)
            }
            throw RemoteAgentError.server("Mac mini 请求失败（\(http.statusCode)）。")
        }
    }

    private func safeDestination(for relativePath: String, inside root: URL) throws -> URL {
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\\") }) else {
            throw RemoteAgentError.unsafeFilePath
        }
        return components.reduce(root) { partial, component in
            partial.appendingPathComponent(String(component), isDirectory: false)
        }
    }
}

private struct CreateJobRequest: Encodable {
    let source: String
    let title: String
    let options: RemoteJobOptions
}
