import Foundation

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

        let script = findScript(diagnostics: &diag)
        let python = findPython(diagnostics: &diag)

        if let script, let python {
            diag.append("[OK] Using python + script mode.")
            let rt = AudioSubtitlesRuntime(invocation: .script(python: python, script: script), environment: environment, diagnostics: diag)
            return (rt, diag)
        }

        if let executable = findExecutable(named: "audio-subtitles", environment: environment) {
            diag.append("[OK] Using standalone audio-subtitles at \(executable.path)")
            let rt = AudioSubtitlesRuntime(invocation: .executable(executable), environment: environment, diagnostics: diag)
            return (rt, diag)
        }

        diag.append("[FAIL] Could not find audio-subtitles CLI or generate_subtitles.py.")
        diag.append("Fix: run ./install.sh from the repo root, or set AUDIO_SUBTITLES_SCRIPT env var.")
        return (nil, diag)
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
        let pathParts = [
            environment["PATH"] ?? "",
            "\(homeDirectory())/.local/bin",
            "\(homeDirectory())/.local/share/audio-subtitles-venv/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ]
        environment["PATH"] = pathParts.filter { !$0.isEmpty }.joined(separator: ":")
        environment["PYTHONNOUSERSITE"] = "1"
        return environment
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

        let relative = "skills/audio-subtitles/scripts/generate_subtitles.py"

        let hardcoded = URL(fileURLWithPath: "/Users/tars/Downloads/project/tars/audio-workflow-skills")
            .appendingPathComponent(relative)
        if FileManager.default.fileExists(atPath: hardcoded.path) {
            diag.append("[script] found at known repo path: \(hardcoded.path)")
            return hardcoded
        }

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
