// El QR calibra la ruta. ARKit mantiene su posición en el mundo al caminar fuera de su vista.
import ARKit
import Combine
import RealityKit
import SwiftUI
import simd

private struct PoseQR {
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

    func cercana(a otra: PoseQR, metros: Float = 0.045, grados: Float = 6) -> Bool {
        simd_distance(posicion, otra.posicion) <= metros &&
            abs(simd_dot(rotacion.vector, otra.rotacion.vector)) >= cos(grados * .pi / 360)
    }

    func afinada(hacia otra: PoseQR) -> PoseQR {
        PoseQR(posicion: posicion + (otra.posicion - posicion) * 0.2,
               rotacion: simd_slerp(rotacion, otra.rotacion, 0.2))
    }
}

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var estado = "🔍 Busca el QR del ancla"
    @Published private(set) var tramoActual: String?
    @Published private(set) var rumboGrados: Double?
    @Published var soloLinea: Bool { didSet { rehacer() } }
    @Published var giro: Int { didSet { aplicarGiro() } }

    let vista = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    let recorrido: Recorrido
    private let marcoQR = Entity()
    private let marcoRuta = Entity()
    private let marcaTramo = Contenido.bola(0.035, Contenido.oro)
    private var origen: AnchorEntity?
    private var contenido: Entity?
    private var poseFija: PoseQR?
    private var candidata: (id: UUID, pose: PoseQR, desde: TimeInterval)?
    private var progreso = ProgresoRuta()
    private var ultimoAviso: TimeInterval = 0
    private var sesionId = UUID()
    private var enMarcha = false
    private var interrumpida = false
    private var pideQR = true
    private var avisoImagen: String?
    private var ladoM: Float { Float(recorrido.ladoCm / 100) }

    init(recorrido: Recorrido) {
        self.recorrido = recorrido
        self.soloLinea = recorrido.soloLinea
        self.giro = recorrido.giro
        super.init()
        vista.session.delegateQueue = .main
        vista.session.delegate = self
        marcoQR.addChild(Contenido.bordeQR(ladoM))
        arrancar()
    }

    private func arrancar() {
        if let origen { vista.scene.removeAnchor(origen) }
        marcoQR.removeFromParent()
        marcoRuta.removeFromParent()
        origen = nil
        poseFija = nil
        candidata = nil
        progreso = ProgresoRuta()
        ultimoAviso = 0
        interrumpida = false
        pideQR = true
        enMarcha = false
        avisoImagen = nil
        sesionId = UUID()
        pausarGuia()
        guard ARWorldTrackingConfiguration.isSupported else {
            mostrarEstado("❌ Este iPhone no admite el seguimiento del entorno.")
            return
        }
        guard let referencia = ImagenQR.referencia(para: recorrido) else {
            mostrarEstado("❌ No se pudo preparar el QR del ancla.")
            return
        }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) { config.sceneReconstruction = .mesh }
        config.detectionImages = [referencia]
        config.maximumNumberOfTrackedImages = 1
        let id = sesionId
        referencia.validate { [weak self] error in
            guard let error else { return }
            DispatchQueue.main.async {
                guard let self, self.sesionId == id, self.poseFija == nil else { return }
                self.avisoImagen = "⚠️ ARKit avisa del QR: \(error.localizedDescription)"
            }
        }
        mostrarEstado("🔍 Busca el QR del ancla (\(recorrido.anclaId))")
        enMarcha = true
        vista.session.run(config, options: [.resetTracking])
    }

    func buscarQR() {
        if !enMarcha || interrumpida {
            arrancar()
            return
        }
        if let estadoCamara = vista.session.currentFrame?.camera.trackingState,
           case .limited(.relocalizing) = estadoCamara {
            arrancar()
            return
        }
        pideQR = true
        candidata = nil
        pausarGuia()
        mostrarEstado("🔍 Vuelve a enfocar el QR del ancla.")
    }

    func detener() {
        enMarcha = false
        sesionId = UUID()
        vista.session.pause()
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard enMarcha, !interrumpida else { return }
        guard case .normal = frame.camera.trackingState else {
            candidata = nil
            pausarGuia()
            let mensaje: String
            switch frame.camera.trackingState {
            case .limited(.relocalizing): mensaje = "Recuperando la posición. Apunta a la zona donde se fijó el QR."
            case .limited(.excessiveMotion): mensaje = "Guía en pausa. Mueve el iPhone más despacio."
            case .limited(.insufficientFeatures): mensaje = "Guía en pausa. Apunta a una zona iluminada con detalles visibles."
            default: mensaje = "Preparando el seguimiento del entorno…"
            }
            mostrarEstado(mensaje)
            return
        }
        let qr = frame.anchors.lazy.compactMap { $0 as? ARImageAnchor }
            .first { $0.isTracked && $0.referenceImage.name == recorrido.anclaId }
        if let qr { observar(qr, en: frame.timestamp) }
        else { candidata = nil }
        guard poseFija != nil, !pideQR else {
            pausarGuia()
            mostrarEstado(qr == nil ? (avisoImagen ?? "🔍 Busca el QR del ancla (\(recorrido.anclaId))")
                         : "Mantén el QR bien encuadrado un momento.")
            return
        }
        marcoQR.isEnabled = true
        marcoRuta.isEnabled = true
        mostrarEstado(qr == nil ? "📍 Ancla fijada en el entorno" : "✅ QR del ancla localizado")
        actualizarTramo(frame)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        interrumpida = true
        candidata = nil
        pausarGuia()
        mostrarEstado("Guía en pausa. Esperando a que vuelva la cámara.")
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        interrumpida = false
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    func session(_ session: ARSession, didFailWithError error: Error) {
        enMarcha = false
        pausarGuia()
        mostrarEstado("❌ AR: \(error.localizedDescription)")
    }

    private func observar(_ imagen: ARImageAnchor, en tiempo: TimeInterval) {
        let muestra = PoseQR(imagen.transform)
        guard let candidata, candidata.id == imagen.identifier, candidata.pose.cercana(a: muestra) else {
            candidata = (id: imagen.identifier, pose: muestra, desde: tiempo)
            return
        }
        guard tiempo - candidata.desde >= 0.12 else { return }
        if !pideQR, let fija = poseFija {
            if !fija.cercana(a: muestra, metros: 0.015, grados: 1.5) {
                colocar(fija.afinada(hacia: muestra))
            }
        } else {
            colocar(muestra)
        }
    }

    private func colocar(_ pose: PoseQR) {
        let matriz = pose.matriz
        // ARKit usa +Y como normal del QR y −Z hacia el borde superior de la imagen.
        let normal = matriz.columns.1
        let haciaAtras = abs(normal.y) >= sqrt(Float(0.5)) ? matriz.columns.2 : normal
        let horizontal = SIMD3<Float>(haciaAtras.x, 0, haciaAtras.z)
        guard simd_length_squared(horizontal) > 0.0001 else { return }
        let z = simd_normalize(horizontal), arriba = SIMD3<Float>(0, 1, 0)
        let x = simd_cross(arriba, z)
        let ruta = simd_float4x4(columns: (SIMD4<Float>(x, 0), SIMD4<Float>(arriba, 0),
                                           SIMD4<Float>(z, 0), matriz.columns.3))
        if origen == nil {
            let fijo = AnchorEntity(world: SIMD3<Float>.zero)
            fijo.addChild(marcoQR)
            fijo.addChild(marcoRuta)
            vista.scene.addAnchor(fijo)
            origen = fijo
            rehacer()
        }
        marcoQR.setTransformMatrix(matriz, relativeTo: origen)
        marcoRuta.setTransformMatrix(ruta, relativeTo: origen)
        poseFija = pose
        pideQR = false
    }

    private func actualizarTramo(_ frame: ARFrame) {
        guard let contenido, frame.timestamp - ultimoAviso >= 0.12 else { return }
        ultimoAviso = frame.timestamp
        let ruta = marcoRuta.transform.matrix * contenido.transform.matrix
        let camara = frame.camera.transform
        let local = simd_inverse(ruta) * camara.columns.3
        let tramo = progreso.actualizar(puntos: recorrido.puntos, posicion: [local.x, local.y, local.z])
        let objetivo = recorrido.puntos[progreso.indice]
        let distancia = tramo.distancia.formatted(.number.precision(.fractionLength(1)))
        let texto = tramo.llegada ? "Destino en esta zona" : "Tramo \(progreso.indice) de \(recorrido.puntos.count - 1) · \(distancia) m"
        if tramoActual != texto { tramoActual = texto }
        marcaTramo.isEnabled = !tramo.llegada
        marcaTramo.position = objetivo + [0, 0.04, 0]
        if tramo.llegada {
            if rumboGrados != nil { rumboGrados = nil }
        } else {
            let direccion = simd_inverse(camara) * (ruta * SIMD4<Float>(objetivo, 1))
            let grados = atan2(Double(direccion.x), Double(-direccion.z)) * 180 / .pi
            let rumbo = (grados / 5).rounded() * 5
            if rumboGrados != rumbo { rumboGrados = rumbo }
        }
    }

    private func rehacer() {
        guard origen != nil else { return }
        contenido?.removeFromParent()
        let c = Contenido.crear(recorrido, ladoM: ladoM, soloLinea: soloLinea)
        marcaTramo.removeFromParent()
        marcaTramo.isEnabled = false
        c.addChild(marcaTramo)
        marcoRuta.addChild(c)
        contenido = c
        aplicarGiro()
    }

    private func aplicarGiro() {
        contenido?.orientation = simd_quatf(angle: Float(giro) * .pi / 180, axis: [0, 1, 0])
        ultimoAviso = 0
    }

    private func pausarGuia() {
        marcoQR.isEnabled = false
        marcoRuta.isEnabled = false
        if tramoActual != nil { tramoActual = nil }
        if rumboGrados != nil { rumboGrados = nil }
    }

    private func mostrarEstado(_ texto: String) {
        if estado != texto { estado = texto }
    }
}

struct VistaAR: UIViewRepresentable {
    let controlador: ControladorAR
    func makeUIView(context: Context) -> ARView { controlador.vista }
    func updateUIView(_ uiView: ARView, context: Context) {}
}
