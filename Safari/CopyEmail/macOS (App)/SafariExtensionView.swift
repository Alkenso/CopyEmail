import AppKit
import SafariServices
import SwiftUI

struct SafariExtensionView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var status: ExtensionStatus = .unknown
    @State private var isOpeningSettings = false
    @State private var errorMessage: String?

    // Matches the existing extension target's bundle identifier.
    private let extensionIdentifier = "\(Bundle.main.bundleIdentifier!).Extension"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(status.title, systemImage: status.symbol)
                .foregroundStyle(status == .enabled ? Color.green : Color.secondary)
            Button("Open Safari Settings…", systemImage: "arrow.up.forward.app") {
                Task { await openSettings() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isOpeningSettings)
            .keyboardShortcut(.return, modifiers: [])
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await refreshStatus()
        }
        .alert("Couldn’t Open Safari Settings", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Open manually Safari → Settings → Extensions to manage CopyEmail.")
        }
    }

    private func refreshStatus() async {
        do {
            let state = try await SFSafariExtensionManager.stateOfSafariExtension(withIdentifier: extensionIdentifier)
            status = state.isEnabled ? .enabled : .disabled
        } catch {
            status = .unknown
        }
    }

    private func openSettings() async {
        isOpeningSettings = true
        defer { isOpeningSettings = false }
        do {
            try await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier)
        } catch {
            errorMessage = "Open Safari → Settings → Extensions to manage CopyEmail. \(error.localizedDescription)"
        }
    }
}

private enum ExtensionStatus {
    case unknown
    case enabled
    case disabled

    var title: LocalizedStringKey {
        switch self {
        case .unknown: "Check CopyEmail’s status in Safari Settings"
        case .enabled: "CopyEmail is enabled"
        case .disabled: "CopyEmail is not enabled"
        }
    }

    var symbol: String {
        switch self {
        case .unknown: "questionmark.circle"
        case .enabled: "checkmark.circle.fill"
        case .disabled: "exclamationmark.circle"
        }
    }
}
