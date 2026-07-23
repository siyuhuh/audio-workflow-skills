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
    @StateObject private var recording = KaraokeRecordingService()
    @StateObject private var packageCreator = PackageCreationService()
    @StateObject private var packageLibrary = PackageLibraryService()

    var body: some Scene {
        WindowGroup("VocalFlow") {
            ContentView()
                .environmentObject(monitor)
                .environmentObject(karaokePlayer)
                .environmentObject(recording)
                .environmentObject(packageCreator)
                .environmentObject(packageLibrary)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 780)
        .windowResizability(.automatic)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
