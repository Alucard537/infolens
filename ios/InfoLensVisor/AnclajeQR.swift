import Foundation
import simd

struct PoseQR {
    let posicion: SIMD3<Float>
    let rotacion: simd_quatf

    init(_ matriz: simd_float4x4) {
        let p = matriz.columns.3
        posicion = [p.x, p.y, p.z]
        rotacion = simd_quatf(matriz)
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

    func combinada(con otra: PoseQR, peso: Float) -> PoseQR {
        PoseQR(posicion: posicion + (otra.posicion - posicion) * peso,
               rotacion: simd_slerp(rotacion, otra.rotacion, peso))
    }

    var marcoInicialRecorrido: simd_float4x4? {
        let m = matriz
        // El primer encuadre alinea el recorrido con los ejes que se usaron para medirlo.
        let normal = m.columns.1
        let haciaAtras = abs(normal.y) >= sqrt(Float(0.5)) ? m.columns.2 : normal
        let horizontal = SIMD3<Float>(haciaAtras.x, 0, haciaAtras.z)
        guard simd_length_squared(horizontal) > 0.0001 else { return nil }
        let z = simd_normalize(horizontal)
        let arriba = SIMD3<Float>(0, 1, 0)
        let x = simd_cross(arriba, z)
        return simd_float4x4(columns: (SIMD4<Float>(x, 0), SIMD4<Float>(arriba, 0),
                                      SIMD4<Float>(z, 0), m.columns.3))
    }
}

struct AnclajeQR {
    private(set) var pose: PoseQR?
    private(set) var rutaDesdeQR: simd_float4x4?
    private var idVisible: UUID?
    private var ultimaVista: TimeInterval = 0
    private var candidata: (id: UUID, referencia: PoseQR, media: PoseQR, cantidad: Int, desde: TimeInterval)?

    mutating func dejarDeVerQR() {
        idVisible = nil
        candidata = nil
    }

    /// Devuelve la pose aceptada. Si el QR se pierde se conserva la última pose en el mundo.
    mutating func observar(_ muestra: PoseQR, id: UUID, en tiempo: TimeInterval) -> PoseQR? {
        let continua = tiempo - ultimaVista <= 0.20
        defer { ultimaVista = tiempo }
        if continua, id == idVisible, let pose {
            let actual = pose.combinada(con: muestra, peso: 0.35)
            self.pose = actual
            return actual
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
            guard let ruta = estable.media.marcoInicialRecorrido else { return nil }
            // A partir de aquí la ruta queda fija en el sistema de coordenadas del papel.
            rutaDesdeQR = simd_inverse(estable.media.matriz) * ruta
        }
        pose = estable.media
        idVisible = id
        candidata = nil
        return estable.media
    }
}
