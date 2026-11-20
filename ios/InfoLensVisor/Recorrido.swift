// Recorrido que manda la app web InfoLens al abrir  infolens://ruta?d=<JSON>
//   p: puntos en METROS desde el centro del QR del ancla (x = derecha, y = arriba, z negativo = ADELANTE)
//   i: información del elemento final · a: id del ancla · l: lado del QR impreso (cm)
//   v: "flechas" | "linea" · q: módulos del QR ("N:hex")
import Foundation
import simd

struct InfoElemento: Codable {
    var nombre: String?
    var referencia: String?
    var id: String?
    var descripcion: String?
}

private struct DatosRecorrido: Codable {
    var p: [[Double]]
    var i: InfoElemento?
    var a: String?
    var l: Double?
    var v: String?
    var q: String?
}

struct Recorrido {
    let clave = UUID()
    var puntos: [SIMD3<Float>]
    var info: InfoElemento
    var anclaId: String
    var ladoCm: Double
    var soloLinea: Bool
    /// Módulos del QR (true = negro), fila a fila desde arriba. nil si la web no los mandó.
    var modulos: [[Bool]]?

    var textoQR: String { "INFOLENS:" + anclaId }

    static func prueba() -> Recorrido {
        // Coincide módulo a módulo con el QR de public/ejemplo/qr-prueba.html.
        let marcador = "21:fea3fc14d06e94bb7505dba52ec10d07faafe01f00b75a5b8dc393c443aaa3a3a6dd004b8bfa64f05c1bba4bfdd53baeb25104e64fe80b0"
        return Recorrido(
            puntos: [[0, 0, 0], [0, 0, -1], [0.5, 0, -1]],
            info: InfoElemento(nombre: "Destino de prueba", referencia: "1 m adelante · 50 cm a la derecha"),
            anclaId: "TEST-1",
            ladoCm: 10,
            soloLinea: false,
            modulos: Recorrido.leerModulos(marcador)
        )
    }

    static func desdeURL(_ url: URL) -> Recorrido? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let d = comps.queryItems?.first(where: { $0.name == "d" })?.value,
              let datos = d.data(using: .utf8),
              let r = try? JSONDecoder().decode(DatosRecorrido.self, from: datos) else { return nil }
        let pts = r.p.compactMap { q -> SIMD3<Float>? in
            q.count == 3 ? SIMD3<Float>(Float(q[0]), Float(q[1]), Float(q[2])) : nil
        }
        guard pts.count >= 2 else { return nil }
        return Recorrido(
            puntos: pts,
            info: r.i ?? InfoElemento(nombre: "Destino"),
            anclaId: r.a ?? "",
            ladoCm: (r.l ?? 10) > 0 ? (r.l ?? 10) : 10,
            soloLinea: r.v == "linea",
            modulos: Recorrido.leerModulos(r.q)
        )
    }

    /// "N:hex" → matriz N x N
    static func leerModulos(_ texto: String?) -> [[Bool]]? {
        guard let texto, let dos = texto.firstIndex(of: ":"), let n = Int(texto[..<dos]), n > 10, n < 200 else { return nil }
        let hex = Array(texto[texto.index(after: dos)...])
        var bits: [Bool] = []
        bits.reserveCapacity(hex.count * 4)
        for c in hex {
            guard let v = c.hexDigitValue else { return nil }
            for k in (0..<4).reversed() { bits.append((v >> k) & 1 == 1) }
        }
        guard bits.count >= n * n else { return nil }
        return (0..<n).map { f in (0..<n).map { c in bits[f * n + c] } }
    }
}
