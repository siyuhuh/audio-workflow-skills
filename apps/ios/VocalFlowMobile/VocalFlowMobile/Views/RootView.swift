import SwiftUI
import UniformTypeIdentifiers

struct RootView: View {
    @StateObject private var library = KaraokeLibrary()
    @StateObject private var queue = KaraokeQueueStore()
    @StateObject private var remoteAgent = RemoteAgentService()
    @State private var selectedPackage: MobileKaraokePackage?
    @State private var showsImporter = false
    @State private var showsRemoteStudio = false

    var body: some View {
        NavigationStack {
            LibraryView(
                library: library,
                queue: queue,
                onImport: { showsImporter = true },
                onRemoteStudio: { showsRemoteStudio = true },
                onPlay: { package in
                    queue.playNow(package)
                    selectedPackage = package
                }
            )
        }
        .tint(AppTheme.primary)
        .fileImporter(
            isPresented: $showsImporter,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first { library.importFolder(url) }
            case .failure(let error):
                library.message = error.localizedDescription
            }
        }
        .fullScreenCover(item: $selectedPackage) { package in
            KaraokeStageView(package: package, queue: queue) {
                selectedPackage = nil
            }
        }
        .sheet(isPresented: $showsRemoteStudio) {
            NavigationStack {
                RemoteStudioView(service: remoteAgent, library: library) { package in
                    showsRemoteStudio = false
                    queue.playNow(package)
                    selectedPackage = package
                }
            }
            .tint(AppTheme.primary)
        }
        .alert("VocalFlow", isPresented: messageBinding) {
            Button("好", role: .cancel) { library.message = nil }
        } message: {
            Text(library.message ?? "")
        }
    }

    private var messageBinding: Binding<Bool> {
        Binding(
            get: { library.message != nil },
            set: { if !$0 { library.message = nil } }
        )
    }
}
