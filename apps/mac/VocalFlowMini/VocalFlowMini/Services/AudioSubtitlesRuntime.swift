import Foundation

struct RuntimeComponentStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let detail: String
    let isAvailable: Bool
    let isRequired: Bool
}

struct AudioSubtitlesRuntimeStatus: Equatable {
    let components: [RuntimeComponentStatus]
    let diagnostics: [String]

    var isReady: Bool {
        components.filter(\.isRequired).allSatisfy(\.isAvailable)
    }

    var summary: String {
        if isReady {
            return "Native processing is ready."
        }

        let missing = components
            .filter { $0.isRequired && !$0.isAvailable }
            .map(\.name)
            .joined(separator: ", ")
        return "Setup required: \(missing)."
    }
}

struct AudioSubtitlesRuntime {
    enum Invocation: Equatable {
        case script(python: URL, script: URL)
        case executable(URL)
    }

    let invocation: Invocation
    let environment: [String: String]
    let diagnostics: [String]

    var summary: String {
        switch invocation {
        case .script(let python, let script):
            return "python: \(python.path)\nscript: \(script.path)"
        case .executable(let url):
            return "executable: \(url.path)"
        }
    }

    static func resolve() -> (runtime: AudioSubtitlesRuntime?, diagnostics: [String]) {
        var diag: [String] = []
        let environment = buildEnvironment()

        diag.append("cwd: \(FileManager.default.currentDirectoryPath)")
        diag.append("HOME: \(homeDirectory())")

        if let override = ProcessInfo.processInfo.environment["AUDIO_SUBTITLES_EXECUTABLE"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.isExecutableFile(atPath: url.path) {
                diag.append("[executable] env override: \(url.path)")
                let runtime = AudioSubtitlesRuntime(
                    invocation: .executable(url),
                    environment: environment,
                    diagnostics: diag
                )
                return (runtime, diag)
            }
            diag.append("[executable] env override NOT executable: \(override)")
        }

        if ProcessInfo.processInfo.environment["AUDIO_SUBTITLES_SCRIPT"] != nil {
            let script = findScript(diagnostics: &diag)
            let python = findPython(diagnostics: &diag)
            if let script, let python {
                diag.append("[OK] Using explicit python + script override.")
                let runtime = AudioSubtitlesRuntime(
                    invocation: .script(python: python, script: script),
                    environment: environment,
                    diagnostics: diag
                )
                return (runtime, diag)
            }
        }

        if let bundledScript = bundledScriptURL(),
           let python = findPython(diagnostics: &diag) {
            diag.append("[OK] Using bundled script with local Python runtime.")
            let runtime = AudioSubtitlesRuntime(
                invocation: .script(python: python, script: bundledScript),
                environment: environment,
                diagnostics: diag
            )
            return (runtime, diag)
        }

        // Source/debug builds do not have an app Resources directory. Prefer
        // the script from the current checkout before a potentially stale
        // globally installed `audio-subtitles` wrapper.
        let script = findScript(diagnostics: &diag)
        let python = findPython(diagnostics: &diag)
        if let script, let python {
            diag.append("[OK] Using python + project script mode.")
            let runtime = AudioSubtitlesRuntime(
                invocation: .script(python: python, script: script),
                environment: environment,
                diagnostics: diag
            )
            return (runtime, diag)
        }

        if let executable = findExecutable(named: "audio-subtitles", environment: environment) {
            diag.append("[OK] Using standalone audio-subtitles fallback at \(executable.path)")
            let runtime = AudioSubtitlesRuntime(
                invocation: .executable(executable),
                environment: environment,
                diagnostics: diag
            )
            return (runtime, diag)
        }

        diag.append("[FAIL] Could not find audio-subtitles CLI or generate_subtitles.py.")
        diag.append("Fix: reinstall VocalFlow. Source builds can run ./install.sh or set AUDIO_SUBTITLES_SCRIPT.")
        return (nil, diag)
    }

    static func inspect() -> AudioSubtitlesRuntimeStatus {
        let resolved = resolve()
        let environment = resolved.runtime?.environment ?? buildEnvironment()
        let runtimeDetail = resolved.runtime?.summary.replacingOccurrences(of: "\n", with: " · ")
            ?? "Reinstall VocalFlow. Source builds can run ./install.sh."

        func executableComponent(_ name: String, label: String, required: Bool) -> RuntimeComponentStatus {
            let url = findExecutable(named: name, environment: environment)
            let missingDetail = required ? "Not found" : "Optional — install when needed"
            return RuntimeComponentStatus(
                id: name,
                name: label,
                detail: url?.path ?? missingDetail,
                isAvailable: url != nil,
                isRequired: required
            )
        }

        return AudioSubtitlesRuntimeStatus(
            components: [
                RuntimeComponentStatus(
                    id: "pipeline",
                    name: "audio-subtitles",
                    detail: runtimeDetail,
                    isAvailable: resolved.runtime != nil,
                    isRequired: true
                ),
                executableComponent("ffmpeg", label: "ffmpeg", required: true),
                executableComponent("yt-dlp", label: "yt-dlp", required: false),
                executableComponent("audio-separator", label: "Vocal separation", required: false)
            ],
            diagnostics: resolved.diagnostics
        )
    }

    static func childProcessEnvironment() -> [String: String] {
        buildEnvironment()
    }

    static func executableURL(named name: String, environment: [String: String]? = nil) -> URL? {
        findExecutable(named: name, environment: environment ?? buildEnvironment())
    }

    func makeProcessArguments(cliArguments: [String]) -> (executableURL: URL, arguments: [String]) {
        switch invocation {
        case .script(let python, let script):
            return (python, [script.path] + cliArguments)
        case .executable(let executable):
            return (executable, cliArguments)
        }
    }

    private static func buildEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let bundledPaths = bundledExecutableDirectories().map(\.path)
        let pathParts = bundledPaths + [
            "\(homeDirectory())/.local/bin",
            "\(homeDirectory())/.local/share/audio-subtitles-venv/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            environment["PATH"] ?? ""
        ]
        environment["PATH"] = pathParts.filter { !$0.isEmpty }.joined(separator: ":")
        environment["PYTHONNOUSERSITE"] = "1"
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        environment["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
        environment["HF_HUB_DISABLE_TELEMETRY"] = "1"
        if let hfHome = writableHuggingFaceHome() {
            environment["HF_HOME"] = hfHome.path
        }
        if let whisperModels = bundledWhisperModelsDirectory() {
            environment["VOCALFLOW_WHISPER_MODEL_DIR"] = whisperModels.path
        }
        environment["AUDIO_SEPARATOR_MODEL_DIR"] = separatorModelsDirectory().path
        return environment
    }

    private static func separatorModelsDirectory() -> URL {
        let fileManager = FileManager.default
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        let target = appSupport
            .appendingPathComponent("VocalFlow", isDirectory: true)
            .appendingPathComponent("separator-models", isDirectory: true)
        try? fileManager.createDirectory(at: target, withIntermediateDirectories: true)
        return target
    }

    private static func findScript(diagnostics diag: inout [String]) -> URL? {
        if let override = ProcessInfo.processInfo.environment["AUDIO_SUBTITLES_SCRIPT"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.fileExists(atPath: url.path) {
                diag.append("[script] env override found: \(url.path)")
                return url
            }
            diag.append("[script] env override NOT found: \(override)")
        }

        if let bundled = bundledScriptURL() {
            diag.append("[script] bundled resource: \(bundled.path)")
            return bundled
        }

        let relative = "skills/audio-subtitles/scripts/generate_subtitles.py"
        for root in candidateRepositoryRoots() {
            let url = root.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: url.path) {
                diag.append("[script] found via tree walk: \(url.path)")
                return url
            }
        }

        diag.append("[script] NOT found. Searched \(candidateRepositoryRoots().count) candidate roots.")
        return nil
    }

    private static func findPython(diagnostics diag: inout [String]) -> URL? {
        if let override = ProcessInfo.processInfo.environment["AUDIO_SUBTITLES_PYTHON"] {
            let url = URL(fileURLWithPath: override)
            if FileManager.default.isExecutableFile(atPath: url.path) {
                diag.append("[python] env override: \(url.path)")
                return url
            }
            diag.append("[python] env override NOT executable: \(override)")
        }

        if let resourceURL = Bundle.main.resourceURL {
            let bundledCandidates = [
                resourceURL.appendingPathComponent("python-runtime/python/bin/python3"),
                resourceURL.appendingPathComponent("python-runtime/python/bin/python"),
                resourceURL.appendingPathComponent("python-runtime/bin/python3"),
                resourceURL.appendingPathComponent("python-runtime/bin/python"),
                resourceURL.appendingPathComponent("python/bin/python3")
            ]
            if let bundled = bundledCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) {
                diag.append("[python] bundled runtime: \(bundled.path)")
                return bundled
            }
        }

        let venvPython = URL(fileURLWithPath: "\(homeDirectory())/.local/share/audio-subtitles-venv/bin/python")
        if FileManager.default.isExecutableFile(atPath: venvPython.path) {
            diag.append("[python] venv python: \(venvPython.path)")
            return venvPython
        }
        diag.append("[python] venv python not found at \(venvPython.path)")

        let env = buildEnvironment()
        if let found = findExecutable(named: "python3", environment: env) {
            diag.append("[python] python3 on PATH: \(found.path)")
            return found
        }

        let fallback = URL(fileURLWithPath: "/usr/bin/python3")
        if FileManager.default.isExecutableFile(atPath: fallback.path) {
            diag.append("[python] fallback /usr/bin/python3")
            return fallback
        }

        diag.append("[python] NO python3 found anywhere")
        return nil
    }

    private static func findExecutable(named name: String, environment: [String: String]) -> URL? {
        let path = environment["PATH"] ?? ""
        for directory in path.split(separator: ":") {
            let url = URL(fileURLWithPath: String(directory)).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: url.path) {
                return url
            }
        }
        return nil
    }

    private static func bundledExecutableDirectories() -> [URL] {
        guard let resourceURL = Bundle.main.resourceURL else { return [] }
        return [
            resourceURL.appendingPathComponent("bin", isDirectory: true),
            resourceURL.appendingPathComponent("ffmpeg-static", isDirectory: true),
            resourceURL.appendingPathComponent("python-runtime/python/bin", isDirectory: true),
            resourceURL.appendingPathComponent("python-runtime/bin", isDirectory: true)
        ]
    }

    private static func writableHuggingFaceHome() -> URL? {
        let fileManager = FileManager.default
        let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        let target = appSupport
            .appendingPathComponent("VocalFlow", isDirectory: true)
            .appendingPathComponent("hf-cache", isDirectory: true)

        do {
            try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
            return target
        } catch {
            return nil
        }
    }

    private static func bundledWhisperModelsDirectory() -> URL? {
        guard let root = Bundle.main.resourceURL?
            .appendingPathComponent("whisper-models", isDirectory: true),
              FileManager.default.fileExists(atPath: root.path) else {
            return nil
        }
        return root
    }

    private static func bundledScriptURL() -> URL? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let candidates = [
            resourceURL.appendingPathComponent("audio-subtitles/scripts/generate_subtitles.py"),
            resourceURL.appendingPathComponent("skills/audio-subtitles/scripts/generate_subtitles.py")
        ]
        return candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) })
    }

    private static func candidateRepositoryRoots() -> [URL] {
        var candidates: [URL] = []

        let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        var cursor: URL? = current
        while let url = cursor {
            candidates.append(url)
            let parent = url.deletingLastPathComponent()
            cursor = parent.path == url.path ? nil : parent
        }

        if let resourceURL = Bundle.main.resourceURL {
            var bundleCursor: URL? = resourceURL
            while let url = bundleCursor {
                candidates.append(url)
                let parent = url.deletingLastPathComponent()
                bundleCursor = parent.path == url.path ? nil : parent
            }
        }

        return candidates.uniquedByPath()
    }

    private static func homeDirectory() -> String {
        FileManager.default.homeDirectoryForCurrentUser.path
    }
}

private extension Array where Element == URL {
    func uniquedByPath() -> [URL] {
        var seen = Set<String>()
        return filter { url in
            seen.insert(url.path).inserted
        }
    }
}
