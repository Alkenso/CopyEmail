import SwiftUI

struct ContentView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
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
        }
        .frame(width: 500)
        .frame(minHeight: 520)
    }

    private var header: some View {
        HStack(spacing: 20) {
            Image(.largeIcon)
                .resizable()
                .scaledToFit()
                .frame(width: 88, height: 88)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 12) {
                Text("CopyEmail")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("Copy emails and addresses right from Safari.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
        }
    }

    private var setup: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 20) {
                SafariExtensionView()
                InstructionRow(
                    number: 1,
                    title: "Enable CopyEmail",
                    detail: "Open Safari Settings → Extensions and turn on CopyEmail."
                )
                InstructionRow(
                    number: 2,
                    title: "Allow website access",
                    detail: "Choose the websites where CopyEmail can run in Safari’s extension settings."
                )
                InstructionRow(
                    number: 3,
                    title: "Start copying",
                    detail:
                        "Return to Safari and reload your page.\nCopy emails, addresses, phones and more..."
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        } label: {
            Label("Set up in Safari", systemImage: "safari")
                .font(.headline)
        }
    }

    private var usage: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                    Text("""
                        Click CopyEmail in Safari’s toolbar to choose:
                        • quick actions appear on websites
                        • categories of data to copy
                        • websites to include or exclude 
                        """)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        } label: {
            Label("Make it yours", systemImage: "slider.horizontal.3")
                .font(.headline)
        }
    }

    private var troubleshooting: some View {
        GroupBox {
            Text(
                "Check that the extension is enabled and has access to the current website, then reload the page. CopyEmail’s website filters can further limit where actions appear. Safari’s start page and other protected pages don’t support extensions."
            )
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        } label: {
            Label("Don’t see CopyEmail?", systemImage: "questionmark.circle")
                .font(.headline)
        }
    }
}

private struct InstructionRow: View {
    let number: Int
    let title: LocalizedStringKey
    let detail: LocalizedStringKey

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
            }
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    ContentView()
}
