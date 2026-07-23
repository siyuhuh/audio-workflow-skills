import Foundation

@MainActor
final class BonjourAgentBrowser: NSObject, ObservableObject {
    @Published private(set) var agents: [DiscoveredAgent] = []
    @Published private(set) var isSearching = false

    private let browser = NetServiceBrowser()
    private var services: [String: NetService] = [:]

    override init() {
        super.init()
        browser.delegate = self
    }

    func start() {
        guard !isSearching else { return }
        agents = []
        services = [:]
        isSearching = true
        browser.searchForServices(ofType: "_vocalflow._tcp.", inDomain: "local.")
    }

    func stop() {
        browser.stop()
        services.values.forEach { $0.stop() }
        isSearching = false
    }
}

extension BonjourAgentBrowser: @preconcurrency NetServiceBrowserDelegate {
    func netServiceBrowserWillSearch(_ browser: NetServiceBrowser) {
        isSearching = true
    }

    func netServiceBrowserDidStopSearch(_ browser: NetServiceBrowser) {
        isSearching = false
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didNotSearch errorDict: [String: NSNumber]
    ) {
        isSearching = false
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didFind service: NetService,
        moreComing: Bool
    ) {
        services[service.name] = service
        service.delegate = self
        service.includesPeerToPeer = true
        service.resolve(withTimeout: 6)
    }

    func netServiceBrowser(
        _ browser: NetServiceBrowser,
        didRemove service: NetService,
        moreComing: Bool
    ) {
        services.removeValue(forKey: service.name)
        agents.removeAll { $0.name == service.name }
    }
}

extension BonjourAgentBrowser: @preconcurrency NetServiceDelegate {
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let rawHost = sender.hostName, sender.port > 0 else { return }
        let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
        let agent = DiscoveredAgent(
            id: "\(sender.name)@\(host):\(sender.port)",
            name: sender.name,
            host: host,
            port: sender.port
        )
        agents.removeAll { $0.name == sender.name }
        agents.append(agent)
        agents.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}
