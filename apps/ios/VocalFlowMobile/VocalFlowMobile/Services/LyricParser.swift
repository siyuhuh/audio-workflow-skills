import Foundation

enum LyricParser {
    static func parse(_ url: URL?) -> [LyricCue] {
        guard let url else { return [] }

        switch url.pathExtension.lowercased() {
        case "json": return parseAudioSubtitlesJSON(url)
        case "lrc": return parseLRC(url)
        case "srt": return parseSRT(url)
        default: return []
        }
    }

    private struct AudioSubtitlesDocument: Decodable {
        let cues: [AudioSubtitlesCue]
    }

    private struct AudioSubtitlesCue: Decodable {
        let start: Double
        let end: Double
        let text: String
        let words: [AudioSubtitlesWord]?
    }

    private struct AudioSubtitlesWord: Decodable {
        let text: String
        let start: Double
        let end: Double
    }

    private static func parseAudioSubtitlesJSON(_ url: URL) -> [LyricCue] {
        guard let data = try? Data(contentsOf: url),
              let document = try? JSONDecoder().decode(AudioSubtitlesDocument.self, from: data) else {
            return []
        }

        return document.cues.map { cue in
            LyricCue(
                start: cue.start,
                end: cue.end,
                text: cue.text.trimmingCharacters(in: .whitespacesAndNewlines),
                words: (cue.words ?? []).map {
                    LyricWord(
                        text: $0.text.trimmingCharacters(in: .whitespacesAndNewlines),
                        start: $0.start,
                        end: $0.end
                    )
                }
            )
        }
    }

    private static func parseLRC(_ url: URL) -> [LyricCue] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let pattern = #"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }

        var entries: [(time: TimeInterval, text: String)] = []
        for line in contents.components(separatedBy: .newlines) {
            let range = NSRange(line.startIndex..<line.endIndex, in: line)
            for match in regex.matches(in: line, range: range) {
                guard let minutesRange = Range(match.range(at: 1), in: line),
                      let secondsRange = Range(match.range(at: 2), in: line),
                      let textRange = Range(match.range(at: 4), in: line),
                      let minutes = Double(line[minutesRange]),
                      let seconds = Double(line[secondsRange]) else { continue }

                var fraction = 0.0
                if let fractionRange = Range(match.range(at: 3), in: line) {
                    let value = String(line[fractionRange])
                    fraction = (Double(value) ?? 0) / pow(10, Double(value.count))
                }
                let text = String(line[textRange]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    entries.append((minutes * 60 + seconds + fraction, text))
                }
            }
        }

        entries.sort { $0.time < $1.time }
        return entries.enumerated().map { index, entry in
            let nextStart = index + 1 < entries.count ? entries[index + 1].time : entry.time + 5
            return LyricCue(start: entry.time, end: max(entry.time + 0.5, nextStart), text: entry.text)
        }
    }

    private static func parseSRT(_ url: URL) -> [LyricCue] {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        let normalized = contents.replacingOccurrences(of: "\r\n", with: "\n")

        return normalized.components(separatedBy: "\n\n").compactMap { block in
            let lines = block.components(separatedBy: .newlines)
            guard let timingLine = lines.first(where: { $0.contains("-->") }) else { return nil }
            let parts = timingLine.components(separatedBy: "-->")
            guard parts.count == 2,
                  let start = parseSRTTime(parts[0]),
                  let end = parseSRTTime(parts[1]) else { return nil }

            let text = lines
                .drop { !$0.contains("-->") }
                .dropFirst()
                .joined(separator: " ")
                .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : LyricCue(start: start, end: end, text: text)
        }
    }

    private static func parseSRTTime(_ value: String) -> TimeInterval? {
        let components = value.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").split(separator: ":")
        guard components.count == 3,
              let hours = Double(components[0]),
              let minutes = Double(components[1]),
              let seconds = Double(components[2]) else { return nil }
        return hours * 3600 + minutes * 60 + seconds
    }
}
