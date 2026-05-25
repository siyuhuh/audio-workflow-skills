import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct VocalFlowMiniApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var monitor = AudioMonitorService()
    @StateObject private var karaokePlayer = KaraokePlayerService()
    @StateObject private var packageCreator = PackageCreationService()
    @StateObject private var packageLibrary = PackageLibraryService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(monitor)
                .environmentObject(karaokePlayer)
                .environmentObject(packageCreator)
                .environmentObject(packageLibrary)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
