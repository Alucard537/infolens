import simd

enum GeometriaFlecha {
    static let largo: Float = 0.32
    static let perfil: [SIMD2<Float>] = [
        [-0.038, 0.135], [0.038, 0.135], [0.038, -0.018],
        [0.108, -0.018], [0, -0.185], [-0.108, -0.018], [-0.038, -0.018],
    ]
    static let carasDeLaTapa = [[0, 1, 2], [0, 2, 6], [3, 4, 2], [2, 4, 6], [6, 4, 5]]

    static func verticesYNormales() -> (vertices: [SIMD3<Float>], normales: [SIMD3<Float>], materiales: [UInt32]) {
        let superior = perfil.map { SIMD3<Float>($0.x, 0.018, $0.y) }
        let inferior = perfil.map { SIMD3<Float>($0.x, -0.018, $0.y) }
        var vertices: [SIMD3<Float>] = [], normales: [SIMD3<Float>] = []
        var materiales: [UInt32] = []

        func triangulo(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ c: SIMD3<Float>, material: UInt32) {
            vertices.append(contentsOf: [a, b, c])
            let n = simd_normalize(simd_cross(b - a, c - a))
            normales.append(contentsOf: [n, n, n])
            materiales.append(material)
        }

        for cara in carasDeLaTapa {
            let a = cara[0], b = cara[1], c = cara[2]
            triangulo(superior[a], superior[b], superior[c], material: 0)
            triangulo(inferior[a], inferior[c], inferior[b], material: 0)
        }
        for i in perfil.indices {
            let j = (i + 1) % perfil.count
            triangulo(superior[i], inferior[i], superior[j], material: 1)
            triangulo(superior[j], inferior[i], inferior[j], material: 1)
        }
        return (vertices, normales, materiales)
    }

    static func escala(profundidad: Float, altoPantalla: Float, anchoPantalla: Float, proyeccionY: Float) -> Float {
        let maximoEnPantalla = min(156, anchoPantalla * 0.40)
        let altoProyectado = altoPantalla * proyeccionY * largo
        guard profundidad > 0.09, altoProyectado > 0 else { return 0 }
        return min(1, 2 * maximoEnPantalla * profundidad / altoProyectado)
    }
}
