import Foundation
import simd

@main
struct PruebaCaraPrincipal {
    static func main() throws {
        let decoder = JSONDecoder()
        let referencias = try decoder.decode([AnclaAR].self, from: Data("""
        [{"id":"PRINCIPAL","ladoCm":10,"cara":"izquierda"},{"id":"ANTIGUA","ladoCm":10}]
        """.utf8))
        precondition(referencias[0].cara == .izquierda && referencias[1].cara == nil)

        let giro = simd_quatf(angle: .pi / 3, axis: SIMD3<Float>(0, 1, 0))
        var marcoPrincipal = simd_float4x4(giro)
        marcoPrincipal.columns.3 = [3, 1, -2, 1]
        let esperada = PoseQR(marcoPrincipal)
        let abajo: SIMD3<Float> = [0, -1, 0]
        let casos: [(cara: SubanclaAR.Cara, centro: SIMD3<Float>, normal: SIMD3<Float>)] = [
            (.frontal, [2, -0.2, -0.4], [1, 0, 0]),
            (.trasera, [-2, 0.1, -0.6], [-1, 0, 0]),
            (.derecha, [0.3, 0.4, -1.8], [0, 0, -1]),
            (.izquierda, [0.2, -0.1, 0], [0, 0, 1]),
        ]
        for caso in casos {
            let subancla = SubanclaAR(anclaId: referencias[0].id, nombre: caso.cara.rawValue,
                                      pos: [caso.centro.x, caso.centro.y, caso.centro.z], cara: caso.cara)
            let marca = simd_float4x4(columns: (SIMD4<Float>(simd_cross(caso.normal, abajo), 0),
                SIMD4<Float>(caso.normal, 0), SIMD4<Float>(abajo, 0), SIMD4<Float>(caso.centro, 1)))
            let observada = PoseQR(marcoPrincipal * marca)
            let recuperada = subancla.poseRecorrido(desde: observada, respectoA: referencias[0].cara)
            precondition(recuperada.cercana(a: esperada, metros: 0.001, grados: 0.5), "Cara \(caso.cara)")

            let colocacion = ColocacionSubancla(cara: caso.cara, ladoCm: 10)
            precondition(colocacion.seVe(desde: caso.centro + caso.normal, punto: caso.centro, respectoA: referencias[0].cara))
            precondition(!colocacion.seVe(desde: caso.centro - caso.normal, punto: caso.centro, respectoA: referencias[0].cara))
        }

        let datos = Data("""
        {"a":"PRINCIPAL","l":10,"p":[[0,0,0],[2,0,-0.4]],"caraPrincipal":"izquierda","colocacion":{"cara":"frontal","ladoCm":10}}
        """.utf8)
        let ruta = Recorrido.desdeDatos(datos)
        precondition(ruta?.ancla.cara == .izquierda && ruta?.colocacion?.cara == .frontal)
        precondition(SubanclaAR.Cara.derecha.normal(respectoA: referencias[1].cara) == [1, 0, 0])

        let rumbo: Float = -1.26
        let centro: SIMD3<Float> = [1.45, -0.3, -1.9]
        let exterior: SIMD3<Float> = [sin(rumbo), 0, cos(rumbo)]
        let imagen = simd_float4x4(columns: (SIMD4<Float>(simd_cross(exterior, abajo), 0),
            SIMD4<Float>(exterior, 0), SIMD4<Float>(abajo, 0), SIMD4<Float>(centro, 1)))
        guard let medicion = MedicionSubancla(principal: marcoPrincipal, subancla: PoseQR(marcoPrincipal * imagen)) else {
            preconditionFailure("No se pudo medir la cara real de la subancla")
        }
        precondition(abs(medicion.giroQR - Double(rumbo)) < 0.001)
        precondition(medicion.pos.enumerated().allSatisfy { abs($0.element - centro[$0.offset]) < 0.001 })
        let calibrada = SubanclaAR(anclaId: "PRINCIPAL", nombre: "TRASERA", pos: medicion.pos, cara: .frontal,
                                  giroQR: medicion.giroQR)
        var otraSesion = simd_float4x4(simd_quatf(angle: -.pi / 6, axis: SIMD3<Float>(0, 1, 0)))
        otraSesion.columns.3 = [-4, -0.2, 5, 1]
        let recuperada = calibrada.poseRecorrido(desde: PoseQR(otraSesion * imagen), respectoA: .izquierda)
        precondition(recuperada.cercana(a: PoseQR(otraSesion), metros: 0.001, grados: 0.5))
        print("Cara del principal y recuperación de las subanclas verificadas")
    }
}
