import SafariServices
import SwiftUI

struct ContentView: View {
    @State private var isOpeningSettings = false
    @State private var isShowingSettingsError = false

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                header
                setup
                usage
                troubleshooting
                Text("CopyEmail works on the websites you allow in Safari.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity)
        }
        .alert("Couldn’t Open Safari Settings", isPresented: $isShowingSettingsError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Open Settings → Apps → Safari → Extensions → CopyEmail to manage the extension.")
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(.largeIcon)
                .resizable()
                .scaledToFit()
                .frame(width: 88, height: 88)
                .accessibilityHidden(true)
            Text("CopyEmail")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Copy emails and addresses right from Safari.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private var setup: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 20) {
                
                InstructionRow(
                    number: 1,
                    title: "Enable CopyEmail",
                    detail:
                        "Go to Settings → Apps → Safari → Extensions → CopyEmail\nand turn on Allow Extension.",
                    footer: openSafariSettingsButton
                )
                InstructionRow(
                    number: 2,
                    title: "Allow website access",
                    detail: "Choose the websites where CopyEmail can run in Safari’s extension settings.",
                    footer: EmptyView()
                )
                InstructionRow(
                    number: 3,
                    title: "Start copying",
                    detail:
                        "Return to Safari and reload your page.\nCopy emails, addresses, phones and more...",
                    footer: EmptyView()
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
        } label: {
            Label("Set up in Safari", systemImage: "safari")
                .font(.headline)
        }
    }
    
    @ContentBuilder
    private var openSafariSettingsButton: some View {
        if #available(iOS 26.2, *) {
            Button("Open Extension Settings", systemImage: "gear") {
                Task { await openExtensionSettings() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isOpeningSettings)
        }
    }

    @available(iOS 26.2, *)
    private func openExtensionSettings() async {
        guard let bundleIdentifier = Bundle.main.bundleIdentifier else { return }
        isOpeningSettings = true
        defer { isOpeningSettings = false }
        do {
            try await SFSafariSettings.openExtensionsSettings(
                forIdentifiers: ["\(bundleIdentifier).Extension"]
            )
        } catch {
            isShowingSettingsError = true
        }
    }

    private var usage: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                Text(
                    "Open Safari’s page menu, then tap CopyEmail to choose which quick actions appear on websites."
                )
                Text("Open Settings in the extension to manage categories, website filters, and appearance.")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
        } label: {
            Label("Make it yours", systemImage: "slider.horizontal.3")
                .font(.headline)
        }
    }

    private var troubleshooting: some View {
        DisclosureGroup("Don’t see CopyEmail?") {
            Text(
                "Check that the extension is enabled and has access to the current website, then reload the page. CopyEmail’s website filters can further limit where actions appear. Safari’s start page and other protected pages don’t support extensions."
            )
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 8)
        }
        .padding(.horizontal, 4)
    }
}

private struct InstructionRow<Footer: View>: View {
    var number: Int
    var title: LocalizedStringKey
    var detail: LocalizedStringKey
    var footer: Footer
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number, format: .number)
                .font(.subheadline.bold())
                .foregroundStyle(.tint)
                .frame(width: 28, height: 28)
                .background(.tint.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                footer
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    ContentView()
}

#Preview {
    ContentView()
        .preferredColorScheme(.dark)
}
