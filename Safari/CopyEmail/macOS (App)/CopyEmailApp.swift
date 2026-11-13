import SwiftUI

@main
struct CopyEmailApp: App {
    var body: some Scene {
        Window("CopyEmail", id: "main") {
            ContentView()
        }
        .defaultSize(width: 500, height: 760)
        .windowResizability(.contentSize)
    }
}
