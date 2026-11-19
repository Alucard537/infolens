import Foundation

enum ConfiguracionSerpista {
    // Dirección pública del servicio existente; no contiene una cuenta ni un token.
    static let inicio = URL(string: "https://serpista-doc.taildb935b.ts.net/app/")!

    static func esServidor(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == inicio.scheme && url.host == inicio.host && url.port == inicio.port
    }
}
