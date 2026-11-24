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

struct ElementosDeGuia: Decodable {
    struct Punto: Decodable {
        let id: Int
        let pos: [Float]

        var valido: Bool { id >= 0 && pos.count == 3 && pos.allSatisfy { $0.isFinite && abs($0) < 1000 } }
        var centro: SIMD4<Float> { [pos[0], pos[1], pos[2], 1] }
    }

    let anclaId: String
    let puntos: [Punto]

    static func desdeDatos(_ datos: Data) -> ElementosDeGuia? {
        guard datos.count <= 200_000, let lista = try? JSONDecoder().decode(Self.self, from: datos),
              !lista.anclaId.isEmpty, !lista.puntos.isEmpty, lista.puntos.allSatisfy(\.valido),
              Set(lista.puntos.map(\.id)).count == lista.puntos.count else { return nil }
        return lista
    }
}

private struct DatosRecorrido: Decodable {
    var p: [[Double]]
    var i: InfoElemento?
    var a: String?
    var l: Double?
    var v: String?
    var q: String?
    var flechas: Bool?
    var icono: Bool?
    var posIcono: [Double]?
    var colocacion: ColocacionSubancla?
    var caraPrincipal: SubanclaAR.Cara?
    var orientacionPrincipal: OrientacionQR?
}

struct ColocacionSubancla: Decodable {
    let cara: SubanclaAR.Cara
    let ladoCm: Double
    var giroQR: Double? = nil
    var orientacion: OrientacionQR? = nil

    var montaje: OrientacionQR { orientacion ?? .vertical }

    func seVe(desde camara: SIMD3<Float>, punto: SIMD3<Float>, respectoA principal: SubanclaAR.Cara? = nil) -> Bool {
        if montaje == .horizontal { return abs(camara.y - punto.y) > 0.04 }
        return simd_dot(camara - punto, cara.normal(respectoA: principal, giroQR: giroQR)) > 0.04
    }
}

struct AnclaAR: Decodable {
    let id: String
    let ladoCm: Double
    let patron: String?
    let cara: SubanclaAR.Cara?
    let orientacion: OrientacionQR?
    let subancla: SubanclaAR?

    init(id: String, ladoCm: Double, patron: String?, cara: SubanclaAR.Cara? = nil,
         orientacion: OrientacionQR? = nil, subancla: SubanclaAR? = nil) {
        self.id = id
        self.ladoCm = ladoCm
        self.patron = patron
        self.cara = cara
        self.orientacion = orientacion
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

        func normal(respectoA principal: Cara?, giroQR: Double? = nil) -> SIMD3<Float> {
            if let giroQR { return [Float(sin(giroQR)), 0, Float(cos(giroQR))] }
            // Las caras se nombran mirando la máquina desde el frontal. Las medidas de la
            // guía ya están en los ejes del QR principal: solo hay que cambiar de base la normal.
            let exterior = (principal ?? .frontal).normal
            let derecha = simd_cross(SIMD3<Float>(0, 1, 0), exterior)
            return [simd_dot(normal, derecha), normal.y, simd_dot(normal, exterior)]
        }

        func ejesMarca(respectoA principal: Cara?, giroQR: Double? = nil, montaje: OrientacionQR = .vertical) -> simd_float3x3 {
            let exterior = normal(respectoA: principal, giroQR: giroQR)
            let arriba = SIMD3<Float>(0, 1, 0)
            let derecha = simd_cross(arriba, exterior)
            return montaje == .horizontal
                ? simd_float3x3(columns: (derecha, arriba, exterior))
                : simd_float3x3(columns: (derecha, exterior, -arriba))
        }
    }

    let anclaId: String
    let nombre: String
    let pos: [Float]
    let cara: Cara
    var giroQR: Double? = nil
    var orientacion: OrientacionQR? = nil

    var montaje: OrientacionQR { orientacion ?? .vertical }

    var valida: Bool {
        !anclaId.isEmpty && anclaId.count <= 120 && !nombre.isEmpty && nombre.count <= 80 &&
            pos.count == 3 && pos.allSatisfy { $0.isFinite && abs($0) < 1000 } && pos.contains { $0 != 0 } &&
            (giroQR.map { $0.isFinite && abs($0) <= .pi } ?? true)
    }

    /// Lleva los ejes del QR de ARKit (derecha, normal, abajo) a los ejes de la guía.
    func poseRecorrido(desde poseQR: PoseQR, respectoA principal: Cara? = nil) -> PoseQR {
        if let giroQR, let medida = poseRecorrido(desde: poseQR, rumbo: giroQR) {
            return medida
        }
        if montaje == .horizontal {
            let exterior = cara.normal(respectoA: principal)
            if let horizontal = poseRecorrido(desde: poseQR, rumbo: atan2(Double(exterior.x), Double(exterior.z))) {
                return horizontal
            }
        }
        let ejes = cara.ejesMarca(respectoA: principal).columns
        let desdeMarca = simd_float4x4(columns: (SIMD4<Float>(ejes.0, 0), SIMD4<Float>(ejes.1, 0),
            SIMD4<Float>(ejes.2, 0), centroLocal))
        return PoseQR(poseQR.matriz * simd_inverse(desdeMarca)).nivelada
    }

    private var centroLocal: SIMD4<Float> { [pos[0], pos[1], pos[2], 1] }

    func centro(en marco: PoseQR) -> SIMD3<Float> {
        let punto = marco.matriz * centroLocal
        return [punto.x, punto.y, punto.z]
    }

    private func poseRecorrido(desde poseQR: PoseQR, rumbo: Double) -> PoseQR? {
        guard let marcoQR = poseQR.marcoInicialRecorrido(orientacion: montaje) else { return nil }
        let giro = simd_quatf(angle: Float(rumbo), axis: SIMD3<Float>(0, 1, 0))
        var desdeMarca = simd_float4x4(giro)
        desdeMarca.columns.3 = centroLocal
        return PoseQR(marcoQR * simd_inverse(desdeMarca))
    }

    /// Izquierda y derecha pueden nombrarse desde el operador. Esto invierte las caras
    /// perpendiculares al principal. Se acepta la otra lectura solo si coincide con el QR principal medido.
    func poseConCaraOpuesta(desde poseQR: PoseQR, respectoA principal: Cara?, principalMedido: PoseQR) -> PoseQR? {
        let normal = cara.normal(respectoA: principal)
        guard giroQR == nil, normal.z == 0,
              let opuesta = poseRecorrido(desde: poseQR, rumbo: atan2(Double(-normal.x), Double(-normal.z))),
              principalMedido.cercana(a: opuesta, metros: 0.25, grados: 8) else { return nil }
        return opuesta
    }

    /// En una referencia medida, un pequeño ruido angular del teléfono no debe
    /// convertirse en un gran desplazamiento del origen al otro lado de la máquina.
    func poseConRumboFijado(observada: PoseQR, nominal: PoseQR, base: PoseQR) -> PoseQR? {
        guard giroQR != nil, base.diferenciaAngular(con: nominal) <= 15 else { return nil }
        let diferencia = observada.posicion - centro(en: base)
        var matriz = base.matriz
        matriz.columns.3 += SIMD4<Float>(diferencia, 0)
        return PoseQR(matriz)
    }
}

struct MedicionSubancla: Encodable {
    let pos: [Float]
    let giroQR: Double

    init?(principal: simd_float4x4, subancla: PoseQR, montaje: OrientacionQR = .vertical) {
        guard let marca = subancla.marcoInicialRecorrido(orientacion: montaje) else { return nil }
        let relativa = simd_inverse(principal) * marca
        let punto = relativa.columns.3
        pos = [punto.x, punto.y, punto.z]
        guard pos.allSatisfy({ $0.isFinite && abs($0) < 1000 }), pos.contains(where: { $0 != 0 }) else { return nil }
        let normal = relativa.columns.2
        giroQR = atan2(Double(normal.x), Double(normal.z))
        guard giroQR.isFinite else { return nil }
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
    var colocacion: ColocacionSubancla?

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
        let ancla = AnclaAR(id: r.a ?? "", ladoCm: r.l ?? 10, patron: r.q, cara: r.caraPrincipal, orientacion: r.orientacionPrincipal)
        let pts = r.p.compactMap(punto)
        guard ancla.valida, pts.count == r.p.count else { return nil }
        if let colocacion = r.colocacion {
            guard pts.count == 2, pts[0] == .zero, pts[1] != .zero, (2...16).contains(colocacion.ladoCm),
                  colocacion.giroQR.map({ $0.isFinite && abs($0) <= .pi }) ?? true else { return nil }
        }
        return Recorrido(
            puntos: pts,
            info: r.i ?? InfoElemento(nombre: "Destino"),
            ancla: ancla,
            soloLinea: r.v == "linea",
            flechas: r.colocacion == nil && (r.flechas ?? true),
            icono: r.colocacion != nil || (r.icono ?? true),
            posIcono: r.colocacion == nil ? r.posIcono.flatMap(punto) : nil,
            colocacion: r.colocacion
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
