// Contenido 3D del recorrido, en coordenadas del QR del ancla (QR en el suelo o en una mesa):
//   x = derecha del QR, y = arriba (sale del QR), z negativo = ADELANTE (borde de arriba del QR).
// Son las mismas coordenadas que usa ARKit para el QR detectado, así que el contenido queda "pegado"
// al QR: si el QR se mueve o se gira, todo se mueve y gira con él.
import RealityKit
import UIKit
import simd

enum Contenido {
    static let verde = UIColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1)
    static let oro = UIColor(red: 1.0, green: 0.78, blue: 0.24, alpha: 1)
    static let azul = UIColor(red: 0.04, green: 0.52, blue: 1.0, alpha: 1)

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

    static func crear(_ r: Recorrido, ladoM: Float, soloLinea: Bool) -> Entity {
        let raiz = Entity()
        raiz.addChild(ancla(alto: max(0.12, ladoM * 1.4)))
        raiz.addChild(bordeQR(ladoM))
        let pts = r.puntos
        for k in 0..<(pts.count - 1) {
            let a = pts[k], b = pts[k + 1], tramo = b - a
            let largo = simd_length(tramo)
            if largo < 0.001 { continue }
            let q = giro(hacia: tramo)
            if soloLinea {
                let linea = caja([0.03, 0.012, largo], verde)
                linea.orientation = q
                linea.position = a + tramo / 2
                raiz.addChild(linea)
                let esquina = bola(0.018, verde)
                esquina.position = b
                raiz.addChild(esquina)
            } else {
                let n = max(1, Int(largo / 0.5))
                for i in 0..<n {
                    let f = flecha()
                    f.orientation = q
                    f.position = a + tramo * ((Float(i) + 0.5) / Float(n))
                    raiz.addChild(f)
                }
            }
        }
        if let fin = pts.last, pts.count >= 2 {
            raiz.addChild(destino(fin, desde: pts[pts.count - 2], info: r.info))
        }
        return raiz
    }

    /// Flecha plana que apunta hacia −Z (unos 16 cm).
    static func flecha() -> Entity {
        let e = Entity()
        let palo = caja([0.035, 0.012, 0.10], verde)
        palo.position = [0, 0, 0.03]
        e.addChild(palo)
        for s: Float in [-1, 1] {
            let brazo = caja([0.03, 0.012, 0.09], verde)
            brazo.orientation = simd_quatf(angle: s * 0.75, axis: [0, 1, 0])
            brazo.position = [s * 0.03, 0, -0.035]
            e.addChild(brazo)
        }
        return e
    }

    /// ⚓ dorado de pie sobre el centro del QR.
    static func ancla(alto: Float) -> Entity {
        let k = alto / 0.16
        let e = Entity()
        let cana = caja([0.012 * k, 0.12 * k, 0.012 * k], oro); cana.position = [0, 0.075 * k, 0]
        let cruz = caja([0.07 * k, 0.012 * k, 0.012 * k], oro); cruz.position = [0, 0.12 * k, 0]
        let aro = bola(0.016 * k, oro); aro.position = [0, 0.15 * k, 0]
        e.addChild(cana); e.addChild(cruz); e.addChild(aro)
        for s: Float in [-1, 1] {
            let brazo = caja([0.06 * k, 0.012 * k, 0.012 * k], oro)
            brazo.orientation = simd_quatf(angle: s * 0.6, axis: [0, 0, 1])
            brazo.position = [s * 0.026 * k, 0.03 * k, 0]
            let punta = bola(0.012 * k, oro); punta.position = [s * 0.05 * k, 0.05 * k, 0]
            e.addChild(brazo); e.addChild(punta)
        }
        let base = caja([0.04 * k, 0.004, 0.04 * k], azul); base.position = [0, 0.002, 0]
        e.addChild(base)
        return e
    }

    /// Borde del QR con líneas discontinuas verdes (el de arriba, ADELANTE, más grueso).
    static func bordeQR(_ lado: Float) -> Entity {
        let e = Entity()
        let h = lado / 2, raya = lado / 8, grosor: Float = 0.004
        let lados: [(SIMD3<Float>, SIMD3<Float>, Float)] = [
            ([-h, 0, -h], [h, 0, -h], 2.2), ([h, 0, -h], [h, 0, h], 1), ([h, 0, h], [-h, 0, h], 1), ([-h, 0, h], [-h, 0, -h], 1),
        ]
        for (a, b, g) in lados {
            let d = b - a
            for i in stride(from: 0, to: 8, by: 2) {
                let t = (Float(i) + 0.5) / 8
                let r = caja([abs(d.x) > 0 ? raya : grosor * g, 0.003, abs(d.z) > 0 ? raya : grosor * g], verde)
                r.position = a + d * t + [0, 0.002, 0]
                e.addChild(r)
            }
        }
        return e
    }

    /// Destino: bola azul con la información del elemento encima, mirando hacia donde llega la persona.
    static func destino(_ fin: SIMD3<Float>, desde previo: SIMD3<Float>, info: InfoElemento) -> Entity {
        let e = Entity()
        e.position = fin
        let i = bola(0.04, azul); i.position = [0, 0.1, 0]
        e.addChild(i)
        var lineas = [info.nombre ?? "Destino"]
        let ref = [info.referencia, info.id].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        if !ref.isEmpty { lineas.append(ref) }
        if let d = info.descripcion, !d.isEmpty { lineas.append(String(d.prefix(60))) }
        let malla = MeshResource.generateText(lineas.joined(separator: "\n"), extrusionDepth: 0.002,
                                              font: .systemFont(ofSize: 0.035, weight: .semibold),
                                              containerFrame: .zero, alignment: .center, lineBreakMode: .byWordWrapping)
        let texto = ModelEntity(mesh: malla, materials: [UnlitMaterial(color: .white)])
        let caja = texto.visualBounds(relativeTo: nil)
        texto.position = [-caja.center.x, -caja.center.y, 0.002]
        let fondo = Contenido.caja([caja.extents.x + 0.04, caja.extents.y + 0.03, 0.004], UIColor(white: 0.08, alpha: 1))
        let cartel = Entity()
        cartel.addChild(fondo); cartel.addChild(texto)
        cartel.position = [0, 0.25, 0]
        // Que el cartel mire hacia el tramo anterior (por donde llega la persona)
        var mira = previo - fin; mira.y = 0
        if simd_length(mira) > 0.001 { cartel.orientation = simd_quatf(angle: atan2(mira.x, mira.z), axis: [0, 1, 0]) }
        e.addChild(cartel)
        return e
    }
}
