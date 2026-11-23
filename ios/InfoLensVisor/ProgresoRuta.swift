import Foundation

struct ProgresoRuta {
    private(set) var indice = 1

    /// Permite iniciar cerca de un tramo posterior al recuperar la guía desde una subancla.
    mutating func ubicarTramo(puntos: [SIMD3<Float>], posicion: SIMD3<Float>) {
        var menorDistancia: Float = 0.65
        for i in 1..<puntos.count {
            let a = puntos[i - 1], b = puntos[i]
            let dx = b.x - a.x, dz = b.z - a.z
            let cuadrado = dx * dx + dz * dz
            guard cuadrado > 0.0001 else { continue }
            let t = min(1, max(0, ((posicion.x - a.x) * dx + (posicion.z - a.z) * dz) / cuadrado))
            let distancia = hypot(posicion.x - (a.x + t * dx), posicion.z - (a.z + t * dz))
            if distancia < menorDistancia {
                menorDistancia = distancia
                indice = i
            }
        }
    }

    mutating func actualizar(puntos: [SIMD3<Float>], posicion: SIMD3<Float>) -> (distancia: Float, llegada: Bool) {
        let ultimo = puntos.count - 1
        while true {
            let anterior = puntos[indice - 1], punto = puntos[indice]
            let dx = punto.x - anterior.x, dz = punto.z - anterior.z
            let largo = hypot(dx, dz)
            let distancia = hypot(punto.x - posicion.x, punto.z - posicion.z)
            let radio = min(0.45, max(0.12, largo * 0.25))
            let cerca = distancia <= radio
            if indice == ultimo { return (distancia, cerca) }
            if !cerca {
                if largo <= 0.001 { return (distancia, false) }
                let x = posicion.x - anterior.x, z = posicion.z - anterior.z
                let avance = (x * dx + z * dz) / largo
                let desviacion = abs(x * dz - z * dx) / largo
                if avance < largo || avance > largo + 2 * radio || desviacion > radio { return (distancia, false) }
            }
            indice += 1
        }
    }
}
