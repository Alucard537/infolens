// Contenido 3D en los ejes del recorrido: derecha, vertical del mundo y adelante (−Z).
import RealityKit
import UIKit
import simd

enum Contenido {
    static let verde = UIColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1)
    static let oro = UIColor(red: 1.0, green: 0.78, blue: 0.24, alpha: 1)
    static let azul = UIColor(red: 0.04, green: 0.52, blue: 1.0, alpha: 1)
    static let menta = UIColor(red: 0.39, green: 0.91, blue: 0.69, alpha: 1)
    static let lateralFlecha = UIColor(red: 0.06, green: 0.42, blue: 0.32, alpha: 1)

    static func material(_ c: UIColor) -> SimpleMaterial { SimpleMaterial(color: c, roughness: 0.4, isMetallic: false) }

    static func caja(_ tam: SIMD3<Float>, _ c: UIColor) -> ModelEntity {
        ModelEntity(mesh: .generateBox(size: tam), materials: [material(c)])
    }
    static func bola(_ radio: Float, _ c: UIColor) -> ModelEntity {
        ModelEntity(mesh: .generateSphere(radius: radio), materials: [material(c)])
    }

    /// Giro que lleva el eje −Z (hacia donde apuntan las flechas) a la dirección dir.
    static func giro(hacia dir: SIMD3<Float>) -> simd_quatf {
        let d = simd_normalize(dir), menosZ = SIMD3<Float>(0, 0, -1)
        if simd_dot(d, menosZ) < -0.9999 { return simd_quatf(angle: .pi, axis: [0, 1, 0]) }
        return simd_quatf(from: menosZ, to: d)
    }

    static func crear(_ r: Recorrido, soloLinea: Bool) -> Entity {
        let raiz = Entity()
        let pts = r.puntos
        let numeroTramos = r.flechas ? pts.count - 1 : 0
        for k in 0..<numeroTramos {
            let a = pts[k], b = pts[k + 1], tramo = b - a
            let largo = simd_length(tramo)
            if largo < 0.001 { continue }
            let q = giro(hacia: tramo)
            if soloLinea {
                let linea = caja([0.012, 0.006, largo], menta)
                linea.orientation = q
                linea.position = a + tramo / 2
                raiz.addChild(linea)
                let esquina = bola(0.012, menta)
                esquina.position = b
                raiz.addChild(esquina)
            } else {
                let n = min(120, max(1, Int(largo / 0.5)))
                for i in 0..<n {
                    let escalaBase = min(1, largo / (0.4 * Float(n)))
                    let f = flecha(escalaBase: escalaBase)
                    f.orientation = q
                    f.position = a + tramo * ((Float(i) + 0.5) / Float(n))
                    raiz.addChild(f)
                }
            }
        }
        if r.icono, let fin = r.posIcono ?? pts.last {
            let destino = bola(0.025, azul)
            destino.position = fin + [0, 0.025, 0]
            raiz.addChild(destino)
        }
        return raiz
    }

    private static let mallaFlecha: MeshResource = {
        var forma = MeshDescriptor(name: "Flecha 3D")
        let (vertices, normales, caras) = GeometriaFlecha.verticesYNormales()
        forma.positions = MeshBuffers.Positions(vertices)
        forma.normals = MeshBuffers.Normals(normales)
        forma.primitives = .triangles(vertices.indices.map(UInt32.init))
        forma.materials = .perFace(caras)
        return (try? MeshResource.generate(from: [forma])) ?? .generateBox(size: 0.02)
    }()

    private static func flecha(escalaBase: Float) -> Entity {
        let materiales: [any Material] = mallaFlecha.expectedMaterialCount == 2
            ? [UnlitMaterial(color: menta), UnlitMaterial(color: lateralFlecha)]
            : [UnlitMaterial(color: menta)]
        let modelo = ModelEntity(mesh: mallaFlecha, materials: materiales)
        modelo.scale = SIMD3<Float>(repeating: escalaBase)
        let e = Entity()
        e.name = "flecha"
        e.addChild(modelo)
        return e
    }

    /// Centro y flecha ADELANTE en el plano del papel: −Z va hacia el borde impreso de arriba.
    static func marcaQR(_ lado: Float) -> Entity {
        let e = Entity()
        let h = lado / 2
        let relieve = lado * 0.012

        func pieza(_ ancho: Float, _ largo: Float, _ color: UIColor) -> ModelEntity {
            ModelEntity(mesh: .generateBox(size: [ancho, relieve, largo]), materials: [UnlitMaterial(color: color)])
        }

        func segmento(_ a: SIMD3<Float>, _ b: SIMD3<Float>, ancho: Float, color: UIColor) {
            let d = b - a
            let r = pieza(ancho, simd_length(d), color)
            r.position = a + d / 2 + [0, relieve, 0]
            r.orientation = giro(hacia: d)
            e.addChild(r)
        }

        let esquinas: [SIMD3<Float>] = [
            [-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h], [-h, 0, -h],
        ]
        for (a, b) in zip(esquinas, esquinas.dropFirst()) {
            let d = (b - a) * 0.25
            segmento(a, a + d, ancho: lado * 0.025, color: verde)
            segmento(b - d, b, ancho: lado * 0.025, color: verde)
        }

        let centro = pieza(lado * 0.13, lado * 0.13, azul)
        centro.position = [0, relieve, 0]
        let punto = pieza(lado * 0.055, lado * 0.055, .white)
        punto.position = [0, relieve * 1.5, 0]
        e.addChild(centro)
        e.addChild(punto)

        let punta = SIMD3<Float>(0, 0, -lado * 0.64)
        segmento([0, 0, -lado * 0.09], punta, ancho: lado * 0.045, color: azul)
        segmento([-lado * 0.12, 0, -lado * 0.49], punta, ancho: lado * 0.045, color: azul)
        segmento([lado * 0.12, 0, -lado * 0.49], punta, ancho: lado * 0.045, color: azul)
        return e
    }
}
