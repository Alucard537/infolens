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
    var flechas: Bool?
    var icono: Bool?
    var posIcono: [Double]?
}

struct AnclaAR: Decodable {
    let id: String
    let ladoCm: Double
    let patron: String?
    let subancla: SubanclaAR?

    init(id: String, ladoCm: Double, patron: String?, subancla: SubanclaAR? = nil) {
        self.id = id
        self.ladoCm = ladoCm
        self.patron = patron
        self.subancla = subancla
    }

    var principalId: String { subancla?.anclaId ?? id }
    var modulos: [[Bool]]? { Recorrido.leerModulos(patron) }
    var textoQR: String { subancla == nil ? "INFOLENS:" + id : id }
    var valida: Bool {
        guard !id.isEmpty, id.count <= 120, (1...200).contains(ladoCm) else { return false }
        guard let subancla else { return true }
        return id.hasPrefix("INFOLENS-SUB:S-") && subancla.valida && (2...16).contains(ladoCm)
    }
}

struct SubanclaAR: Decodable {
    enum Cara: String, Decodable {
        case frontal, derecha, trasera, izquierda

        var normal: SIMD3<Float> {
            switch self {
            case .frontal: return [0, 0, 1]
            case .derecha: return [1, 0, 0]
            case .trasera: return [0, 0, -1]
            case .izquierda: return [-1, 0, 0]
            }
        }
    }

    let anclaId: String
    let nombre: String
    let pos: [Float]
    let cara: Cara

    var valida: Bool {
        !anclaId.isEmpty && anclaId.count <= 120 && !nombre.isEmpty && nombre.count <= 80 &&
            pos.count == 3 && pos.allSatisfy { $0.isFinite && abs($0) < 1000 } && pos.contains { $0 != 0 }
    }

    /// Lleva los ejes del QR de ARKit (derecha, normal, abajo) a los ejes de la guía.
    func poseRecorrido(desde poseQR: PoseQR) -> PoseQR {
        let y = cara.normal
        let z = SIMD3<Float>(0, -1, 0)
        let x = simd_cross(y, z)
        let desdeMarca = simd_float4x4(columns: (SIMD4<Float>(x, 0), SIMD4<Float>(y, 0),
            SIMD4<Float>(z, 0), SIMD4<Float>(pos[0], pos[1], pos[2], 1)))
        return PoseQR(poseQR.matriz * simd_inverse(desdeMarca))
    }
}

struct Recorrido {
    let clave = UUID()
    let puntos: [SIMD3<Float>]
    let info: InfoElemento
    let ancla: AnclaAR
    let soloLinea: Bool
    var flechas = true
    var icono = true
    var posIcono: SIMD3<Float>?

    var anclaId: String { ancla.id }
    var ladoCm: Double { ancla.ladoCm }
    var modulos: [[Bool]]? { ancla.modulos }
    var textoQR: String { ancla.textoQR }

    static func prueba() -> Recorrido {
        // Coincide módulo a módulo con el QR de public/ejemplo/qr-prueba.html.
        let marcador = "21:fea3fc14d06e94bb7505dba52ec10d07faafe01f00b75a5b8dc393c443aaa3a3a6dd004b8bfa64f05c1bba4bfdd53baeb25104e64fe80b0"
        return Recorrido(
            puntos: [[0, 0, 0], [0, 0, -1], [0.5, 0, -1]],
            info: InfoElemento(nombre: "Destino de prueba", referencia: "1 m adelante · 50 cm a la derecha"),
            ancla: AnclaAR(id: "TEST-1", ladoCm: 10, patron: marcador),
            soloLinea: false
        )
    }

    static func desdeURL(_ url: URL) -> Recorrido? {
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let d = comps.queryItems?.first(where: { $0.name == "d" })?.value else { return nil }
        return desdeDatos(Data(d.utf8))
    }

    static func desdeDatos(_ datos: Data) -> Recorrido? {
        guard datos.count <= 100_000,
              let r = try? JSONDecoder().decode(DatosRecorrido.self, from: datos),
              (2...200).contains(r.p.count) else { return nil }
        let ancla = AnclaAR(id: r.a ?? "", ladoCm: r.l ?? 10, patron: r.q)
        let pts = r.p.compactMap(punto)
        guard ancla.valida, pts.count == r.p.count else { return nil }
        return Recorrido(
            puntos: pts,
            info: r.i ?? InfoElemento(nombre: "Destino"),
            ancla: ancla,
            soloLinea: r.v == "linea",
            flechas: r.flechas ?? true,
            icono: r.icono ?? true,
            posIcono: r.posIcono.flatMap(punto)
        )
    }

    private static func punto(_ q: [Double]) -> SIMD3<Float>? {
        guard q.count == 3, q.allSatisfy({ $0.isFinite && abs($0) < 1000 }) else { return nil }
        return SIMD3<Float>(Float(q[0]), Float(q[1]), Float(q[2]))
    }

    /// "N:hex" → matriz N x N
    static func leerModulos(_ texto: String?) -> [[Bool]]? {
        guard let texto, let dos = texto.firstIndex(of: ":"), let n = Int(texto[..<dos]), n > 10, n < 200 else { return nil }
        let hex = texto[texto.index(after: dos)...]
        guard hex.count == (n * n + 3) / 4 else { return nil }
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
