import Foundation
import simd

enum OrientacionQR: String, Decodable {
    case vertical, horizontal

    func coincide(con pose: PoseQR) -> Bool {
        let ejes = pose.matriz.columns
        return self == .vertical ? ejes.2.y <= -0.94 : abs(ejes.1.y) >= 0.94
    }

    var instruccion: String {
        switch self {
        case .vertical: return "Coloca el QR en vertical, con la flecha hacia arriba."
        case .horizontal: return "Coloca el QR en horizontal, con la flecha hacia dentro de la máquina."
        }
    }
}

struct PoseQR {
    private static let arribaMundo = SIMD3<Float>(0, 1, 0)
    let posicion: SIMD3<Float>
    let rotacion: simd_quatf

    init(_ matriz: simd_float4x4) {
        let p = matriz.columns.3
        posicion = [p.x, p.y, p.z]
        let x = SIMD3<Float>(matriz.columns.0.x, matriz.columns.0.y, matriz.columns.0.z)
        let y = SIMD3<Float>(matriz.columns.1.x, matriz.columns.1.y, matriz.columns.1.z)
        let z = simd_cross(x, y)
        let derecha = simd_normalize(x)
        let normal = simd_normalize(simd_cross(z, derecha))
        rotacion = simd_quatf(simd_float3x3(columns: (derecha, normal, simd_cross(derecha, normal))))
    }

    private init(posicion: SIMD3<Float>, rotacion: simd_quatf) {
        self.posicion = posicion
        self.rotacion = rotacion
    }

    var matriz: simd_float4x4 {
        var m = simd_float4x4(rotacion)
        m.columns.3 = SIMD4<Float>(posicion, 1)
        return m
    }

    func cercana(a otra: PoseQR, metros: Float = 0.03, grados: Float = 3) -> Bool {
        simd_distance(posicion, otra.posicion) <= metros &&
            abs(simd_dot(rotacion.vector, otra.rotacion.vector)) >= cos(grados * .pi / 360)
    }

    func diferenciaAngular(con otra: PoseQR) -> Float {
        let coseno = min(1, abs(simd_dot(rotacion.vector, otra.rotacion.vector)))
        return acos(coseno) * 360 / .pi
    }

    func combinada(con otra: PoseQR, peso: Float) -> PoseQR {
        PoseQR(posicion: posicion + (otra.posicion - posicion) * peso,
               rotacion: simd_slerp(rotacion, otra.rotacion, peso))
    }

    func marcoInicialRecorrido(orientacion: OrientacionQR? = nil) -> simd_float4x4? {
        let m = matriz
        // El primer encuadre alinea el recorrido con los ejes que se usaron para medirlo.
        let normal = m.columns.1
        let tumbado = orientacion.map { $0 == .horizontal } ?? (abs(normal.y) >= sqrt(Float(0.5)))
        let haciaAtras = tumbado ? m.columns.2 : normal
        let horizontal = Self.enHorizontal(haciaAtras)
        guard simd_length_squared(horizontal) > 0.0001 else { return nil }
        return Self.marcoNivelado(horizontal: horizontal, centro: m.columns.3)
    }

    var nivelada: PoseQR {
        let m = matriz
        var horizontal = Self.enHorizontal(m.columns.2)
        if simd_length_squared(horizontal) < 0.0001 {
            horizontal = simd_cross(Self.enHorizontal(m.columns.0), Self.arribaMundo)
        }
        return PoseQR(Self.marcoNivelado(horizontal: horizontal, centro: m.columns.3))
    }

    private static func enHorizontal(_ eje: SIMD4<Float>) -> SIMD3<Float> {
        [eje.x, 0, eje.z]
    }

    private static func marcoNivelado(horizontal: SIMD3<Float>, centro: SIMD4<Float>) -> simd_float4x4 {
        let z = simd_normalize(horizontal)
        let x = simd_cross(arribaMundo, z)
        return simd_float4x4(columns: (SIMD4<Float>(x, 0), SIMD4<Float>(arribaMundo, 0), SIMD4<Float>(z, 0), centro))
    }
}

struct AnclajeQR {
    private var pose: PoseQR?
    private var rutaDesdeQR: simd_float4x4?
    private var idVisible: UUID?
    private var ultimaVista: TimeInterval = 0
    private var candidata: (id: UUID, referencia: PoseQR, media: PoseQR, cantidad: Int, desde: TimeInterval)?

    var poseRecorrido: PoseQR? {
        guard let pose, let rutaDesdeQR else { return nil }
        return PoseQR(pose.matriz * rutaDesdeQR).nivelada
    }

    mutating func dejarDeVerQR() {
        idVisible = nil
        candidata = nil
    }

    /// Devuelve la pose aceptada. Si el QR se pierde se conserva la última pose en el mundo.
    mutating func observar(_ muestra: PoseQR, id: UUID, en tiempo: TimeInterval, orientacion: OrientacionQR? = nil) -> PoseQR? {
        let continua = tiempo - ultimaVista <= 0.20
        defer { ultimaVista = tiempo }
        if continua, id == idVisible {
            pose = muestra
            return muestra
        }
        idVisible = nil
        guard continua, var estable = candidata,
              estable.id == id, estable.referencia.cercana(a: muestra) else {
            candidata = (id, muestra, muestra, 1, tiempo)
            return nil
        }
        estable.cantidad += 1
        estable.media = estable.media.combinada(con: muestra, peso: 1 / Float(estable.cantidad))
        candidata = estable
        guard estable.cantidad >= 5, tiempo - estable.desde >= 0.25 else { return nil }

        if rutaDesdeQR == nil {
            guard let ruta = estable.media.marcoInicialRecorrido(orientacion: orientacion) else { return nil }
            // Esta referencia conserva el rumbo del recorrido respecto al QR al volver a verlo.
            rutaDesdeQR = simd_inverse(estable.media.matriz) * ruta
        }
        pose = muestra
        idVisible = id
        candidata = nil
        return muestra
    }
}

/// Promedia una captura breve sin mover la referencia que usan los recorridos en directo.
struct MuestreoPosesQR {
    typealias Muestra = (id: UUID, pose: PoseQR)
    private var primeras: [Muestra] = []
    private var medias: [PoseQR] = []
    private var inicio: TimeInterval = 0
    private var ultimo: TimeInterval = 0
    private var cantidad = 0

    mutating func observar(_ muestras: [Muestra], en tiempo: TimeInterval) -> [PoseQR]? {
        guard !muestras.isEmpty else {
            self = .init()
            return nil
        }
        let continuo = tiempo >= ultimo && tiempo - ultimo <= 0.20
        let coincide = primeras.count == muestras.count && zip(primeras, muestras).allSatisfy { pareja in
            pareja.0.id == pareja.1.id && pareja.0.pose.cercana(a: pareja.1.pose, metros: 0.025, grados: 3)
        }
        guard continuo, coincide else {
            primeras = muestras
            medias = muestras.map { $0.pose }
            inicio = tiempo
            ultimo = tiempo
            cantidad = 1
            return nil
        }
        guard tiempo > ultimo else { return nil }
        ultimo = tiempo
        cantidad += 1
        for i in medias.indices {
            medias[i] = medias[i].combinada(con: muestras[i].pose, peso: 1 / Float(cantidad))
        }
        return cantidad >= 10 && tiempo - inicio >= 0.65 ? medias : nil
    }
}
