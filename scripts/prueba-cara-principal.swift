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

            var invertida = marca
            invertida.columns.0 = -marca.columns.0
            invertida.columns.1 = -marca.columns.1
            let observacionInvertida = PoseQR(marcoPrincipal * invertida)
            let corregida = subancla.poseConCaraOpuesta(desde: observacionInvertida, respectoA: .izquierda, principalMedido: esperada)
            if caso.normal.x != 0 {
                precondition(corregida?.cercana(a: esperada, metros: 0.001, grados: 0.5) == true)
                invertida.columns.3.x += 0.10
                precondition(subancla.poseConCaraOpuesta(desde: PoseQR(marcoPrincipal * invertida), respectoA: .izquierda,
                                                        principalMedido: esperada) != nil)
                invertida.columns.3.x += 0.30
                precondition(subancla.poseConCaraOpuesta(desde: PoseQR(marcoPrincipal * invertida), respectoA: .izquierda,
                                                        principalMedido: esperada) == nil)
            } else {
                precondition(corregida == nil)
            }

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

        let lejana = SubanclaAR(anclaId: "PRINCIPAL", nombre: "Subancla distante", pos: [6, -0.3, -2], cara: .trasera,
                                giroQR: Double(rumbo))
        let inclinacion = rumbo + 7 * .pi / 180
        let normalRuidosa: SIMD3<Float> = [sin(inclinacion), 0, cos(inclinacion)]
        let imagenRuidosa = simd_float4x4(columns: (SIMD4<Float>(simd_cross(normalRuidosa, abajo), 0),
            SIMD4<Float>(normalRuidosa, 0), SIMD4<Float>(abajo, 0), [6.1, -0.3, -2, 1]))
        let observada = PoseQR(otraSesion * imagenRuidosa)
        let nominal = lejana.poseRecorrido(desde: observada)
        let base = PoseQR(otraSesion)
        precondition(!nominal.cercana(a: base, metros: 0.50, grados: 15))
        guard let corregida = lejana.poseConRumboFijado(observada: observada, nominal: nominal, base: base) else {
            preconditionFailure("El ruido angular cercano no debe impedir una corrección pequeña")
        }
        precondition(simd_length(lejana.centro(en: corregida) - observada.posicion) < 0.001)
        precondition(corregida.diferenciaAngular(con: base) < 0.5)
        print("Cara del principal y recuperación de las subanclas verificadas")
        probarRecorridoNivelado()
        try probarColocacionDelQR()
        probarElementosDeGuia()
        probarMuestreoDePrecision()
        probarMedicionConSubanclaIntermedia()
    }

    static func probarMedicionConSubanclaIntermedia() {
        let base = PoseQR(matrix_identity_float4x4)
        let intermedia = SubanclaAR(anclaId: "PRINCIPAL", nombre: "Intermedia", pos: [-1, 0, -0.4],
                                   cara: .frontal, giroQR: 0)
        let deriva: SIMD4<Float> = [0.13, 0.01, 0.10, 0]
        var marca = simd_float4x4(columns: ([1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [-1, 0, -0.4, 1]))
        marca.columns.3 += deriva
        let lectura = PoseQR(marca)
        let nominal = intermedia.poseRecorrido(desde: lectura)
        guard let corregida = intermedia.poseConRumboFijado(observada: lectura, nominal: nominal, base: base) else {
            preconditionFailure("No se recuperó el origen desde la subancla intermedia")
        }

        let destino: SIMD4<Float> = [-1.65, -1, -0.25, 1]
        marca.columns.3 = destino + deriva
        guard let medida = MedicionSubancla(principal: corregida.matriz, subancla: PoseQR(marca),
                                           principalSinCorregir: base.matriz), let original = medida.posSinCorregir else {
            preconditionFailure("Falta una de las dos mediciones del mismo destino")
        }
        let sinCorregir = destino + deriva
        let medidaCorregida = SIMD3<Float>(medida.pos[0], medida.pos[1], medida.pos[2])
        let medidaOriginal = SIMD3<Float>(original[0], original[1], original[2])
        precondition(simd_distance(medidaCorregida, [destino.x, destino.y, destino.z]) < 0.001)
        precondition(simd_distance(medidaOriginal, [sinCorregir.x, sinCorregir.y, sinCorregir.z]) < 0.001)
        print("Comparación del mismo destino con y sin subancla intermedia verificada")
    }

    static func probarMuestreoDePrecision() {
        var muestreo = MuestreoPosesQR()
        let principal = UUID(), secundaria = UUID()
        func muestra(_ id: UUID, _ x: Float) -> MuestreoPosesQR.Muestra {
            var matriz = matrix_identity_float4x4
            matriz.columns.3.x = x
            return (id, PoseQR(matriz))
        }
        var poses: [PoseQR]?
        for i in 0...14 {
            let ruido: Float = i.isMultiple(of: 2) ? 0.006 : -0.006
            poses = muestreo.observar([muestra(principal, 1 + ruido), muestra(secundaria, 2 - ruido)],
                                     en: 1 + Double(i) * 0.05)
            if i < 13 { precondition(poses == nil, "No debe confirmar antes de completar la ventana estable") }
        }
        precondition(poses?.count == 2)
        precondition(abs(poses![0].posicion.x - 1) < 0.001)
        precondition(abs(poses![1].posicion.x - 2) < 0.001)
        precondition(muestreo.observar([muestra(principal, 1), muestra(secundaria, 2.1)], en: 1.75) == nil)
        precondition(muestreo.observar([], en: 1.80) == nil)
        precondition(muestreo.observar([muestra(principal, 1)], en: 1.85) == nil)
        precondition(muestreo.observar([muestra(principal, 1)], en: 2.1) == nil)
        print("Lectura media de los QR y reinicio ante saltos verificados")
    }

    static func probarElementosDeGuia() {
        let valido = Data("""
        {"anclaId":"PRINCIPAL","puntos":[{"id":0,"pos":[1,0.2,-2]},{"id":2,"pos":[-1,0,0]}]}
        """.utf8)
        guard let elementos = ElementosDeGuia.desdeDatos(valido) else { preconditionFailure("Faltan las posiciones de los elementos") }
        precondition(elementos.anclaId == "PRINCIPAL" && elementos.puntos.map(\.id) == [0, 2])
        precondition(elementos.puntos[0].centro == [1, 0.2, -2, 1])
        let repetido = Data("""
        {"anclaId":"PRINCIPAL","puntos":[{"id":1,"pos":[1,0,0]},{"id":1,"pos":[0,0,1]}]}
        """.utf8)
        let incompleto = Data("""
        {"anclaId":"PRINCIPAL","puntos":[{"id":0,"pos":[1,0]}]}
        """.utf8)
        precondition(ElementosDeGuia.desdeDatos(repetido) == nil)
        precondition(ElementosDeGuia.desdeDatos(incompleto) == nil)
        print("Vista de elementos anclada al QR principal verificada")
    }

    static func probarColocacionDelQR() throws {
        let pared = simd_float4x4(columns: ([1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]))
        let paredInvertida = pared * simd_float4x4(simd_quatf(angle: .pi, axis: [0, 1, 0]))
        precondition(OrientacionQR.vertical.coincide(con: PoseQR(pared)))
        precondition(!OrientacionQR.vertical.coincide(con: PoseQR(paredInvertida)))
        precondition(!OrientacionQR.horizontal.coincide(con: PoseQR(pared)))
        precondition(!OrientacionQR.vertical.coincide(con: PoseQR(matrix_identity_float4x4)))

        let json = Data("""
        {"a":"PRINCIPAL","l":10,"p":[[0,0,0],[1,0,-0.8]],"orientacionPrincipal":"horizontal",
        "colocacion":{"cara":"derecha","ladoCm":10,"orientacion":"horizontal"}}
        """.utf8)
        guard let ruta = Recorrido.desdeDatos(json), let colocacion = ruta.colocacion else {
            preconditionFailure("No se cargó la colocación del QR")
        }
        precondition(ruta.ancla.orientacion == .horizontal && colocacion.montaje == .horizontal)
        precondition(colocacion.seVe(desde: [0, -1, 0], punto: .zero))
        precondition(!colocacion.seVe(desde: [1, 0, 0], punto: .zero))

        let subancla = try JSONDecoder().decode(SubanclaAR.self, from: Data("""
        {"anclaId":"PRINCIPAL","nombre":"Subancla superior","pos":[1,0,-0.8],"cara":"derecha","orientacion":"horizontal"}
        """.utf8))
        let ejes = subancla.cara.ejesMarca(respectoA: .frontal, montaje: subancla.montaje).columns
        let centro: SIMD4<Float> = [1, 0, -0.8, 1]
        let papelSuperior = simd_float4x4(columns: (SIMD4<Float>(ejes.0, 0), SIMD4<Float>(ejes.1, 0), SIMD4<Float>(ejes.2, 0), centro))
        var papelInferior = papelSuperior
        papelInferior.columns.0 = -papelSuperior.columns.0
        papelInferior.columns.1 = -papelSuperior.columns.1

        for papel in [papelSuperior, papelInferior] {
            let muestra = PoseQR(papel)
            precondition(OrientacionQR.horizontal.coincide(con: muestra))
            guard let marco = muestra.marcoInicialRecorrido(orientacion: .horizontal) else {
                preconditionFailure("Falta la dirección de la flecha del QR tumbado")
            }
            let adelante = marco * SIMD4<Float>(0, 0, -1, 0)
            precondition(simd_distance(adelante, [-1, 0, 0, 0]) < 0.001)
            precondition(subancla.poseRecorrido(desde: muestra, respectoA: .frontal).cercana(a: PoseQR(matrix_identity_float4x4)))
            let medida = MedicionSubancla(principal: matrix_identity_float4x4, subancla: muestra, montaje: .horizontal)
            precondition(abs((medida?.giroQR ?? 0) - .pi / 2) < 0.001)
        }
        print("QR vertical hacia arriba y QR horizontal hacia el interior verificados")
    }

    static func probarRecorridoNivelado() {
        let pared = simd_float4x4(columns: ([1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]))
        let origen: SIMD4<Float> = [4, 1.2, -2, 1]
        let giro = simd_float4x4(simd_quatf(angle: .pi / 2, axis: [0, 1, 0]))
        let inclinacion = simd_float4x4(simd_quatf(angle: .pi / 15, axis: [1, 0, 0]))

        for papel in [pared, matrix_identity_float4x4] {
            var anclaje = AnclajeQR()
            let id = UUID()
            for muestra in 0..<6 {
                _ = anclaje.observar(PoseQR(papel), id: id, en: Double(muestra) * 0.06)
            }
            var lecturaInclinada = giro * inclinacion * papel
            lecturaInclinada.columns.3 = origen
            precondition(anclaje.observar(PoseQR(lecturaInclinada), id: id, en: 0.36) != nil)
            guard let ruta = anclaje.poseRecorrido else { preconditionFailure("Falta la pose del recorrido") }
            comprobarTramos(ruta, origen: origen)
            anclaje.dejarDeVerQR()
            precondition(anclaje.poseRecorrido?.cercana(a: ruta) == true)
        }

        let subancla = SubanclaAR(anclaId: "PRINCIPAL", nombre: "Subancla manual", pos: [2, 0, 0], cara: .frontal)
        var poseInclinada = giro * inclinacion
        poseInclinada.columns.3 = origen
        var marcaRelativa = pared
        marcaRelativa.columns.3 = [2, 0, 0, 1]
        comprobarTramos(subancla.poseRecorrido(desde: PoseQR(poseInclinada * marcaRelativa)), origen: origen)

        // Si el eje de avance se vuelve vertical, el borde lateral sigue dando un rumbo horizontal.
        var ejeVertical = giro * simd_float4x4(simd_quatf(angle: .pi / 2, axis: [1, 0, 0]))
        ejeVertical.columns.3 = origen
        comprobarTramos(PoseQR(ejeVertical).nivelada, origen: origen)
        print("Tramos horizontales y verticales verificados tras inclinar, girar y perder de vista el QR")
    }

    private static func comprobarTramos(_ ruta: PoseQR, origen: SIMD4<Float>) {
        let inicio = ruta.matriz * SIMD4<Float>(0, 0, 0, 1)
        let adelante = ruta.matriz * SIMD4<Float>(0, 0, -2.5, 1)
        let abajo = ruta.matriz * SIMD4<Float>(0, -0.8, -2.5, 1)
        precondition(simd_distance(inicio, origen) < 0.001)
        precondition(simd_distance(adelante - inicio, [-2.5, 0, 0, 0]) < 0.001)
        precondition(simd_distance(abajo - adelante, [0, -0.8, 0, 0]) < 0.001)
    }
}
