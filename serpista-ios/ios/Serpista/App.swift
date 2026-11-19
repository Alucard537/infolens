import SwiftUI

@main
struct SerpistaApp: App {
    var body: some Scene {
        WindowGroup {
            SerpistaPrincipal()
                .preferredColorScheme(.light)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct SerpistaPrincipal: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SerpistaViewController {
        SerpistaViewController()
    }

    func updateUIViewController(_ uiViewController: SerpistaViewController, context: Context) {}
}
