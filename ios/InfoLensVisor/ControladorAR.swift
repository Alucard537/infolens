// La ruta es hija del QR. ARKit conserva su última posición en el mundo mientras el QR no se ve.
import ARKit
import Combine
import RealityKit
import SwiftUI
import simd

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var estado = "🔍 Busca el QR del ancla"
    @Published private(set) var tramoActual: String?
    @Published private(set) var rumboGrados: Double?
    @Published var soloLinea: Bool { didSet { rehacer() } }

    let vista = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    let recorrido: Recorrido
    private let marcoQR = Entity()
    private let marcoRuta = Entity()
    private let marcaTramo = Contenido.bola(0.035, Contenido.oro)
    private var origen: AnchorEntity?
    private var contenido: Entity?
    private var anclaje = AnclajeQR()
    private var poseParaProgreso: PoseQR?
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
        super.init()
        vista.session.delegateQueue = .main
        vista.session.delegate = self
        marcoQR.addChild(Contenido.bordeQR(ladoM))
        marcoQR.addChild(marcoRuta)
        arrancar()
    }

    private func arrancar() {
        if let origen { vista.scene.removeAnchor(origen) }
        marcoQR.removeFromParent()
        origen = nil
        anclaje = AnclajeQR()
        poseParaProgreso = nil
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
                guard let self, self.sesionId == id, self.origen == nil else { return }
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
        anclaje.dejarDeVerQR()
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
            anclaje.dejarDeVerQR()
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
        let poseActual = qr.flatMap { anclaje.observar(PoseQR($0.transform), id: $0.identifier, en: frame.timestamp) }
        if let poseActual { aplicarPoseQR(poseActual) }
        guard origen != nil, !pideQR, qr == nil || poseActual != nil else {
            pausarGuia()
            mostrarEstado(qr == nil ? (avisoImagen ?? "🔍 Busca el QR del ancla (\(recorrido.anclaId))")
                         : "Mantén el QR bien encuadrado un momento.")
            return
        }
        marcoQR.isEnabled = true
        mostrarEstado(qr == nil ? "📍 Última posición del QR en el entorno" : "✅ Siguiendo el QR del ancla")
        actualizarTramo(frame)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        interrumpida = true
        anclaje.dejarDeVerQR()
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

    private func aplicarPoseQR(_ pose: PoseQR) {
        if origen == nil {
            guard let rutaDesdeQR = anclaje.rutaDesdeQR else { return }
            let fijo = AnchorEntity(world: SIMD3<Float>.zero)
            fijo.addChild(marcoQR)
            marcoRuta.setTransformMatrix(rutaDesdeQR, relativeTo: marcoQR)
            vista.scene.addAnchor(fijo)
            origen = fijo
            rehacer()
        }
        marcoQR.setTransformMatrix(pose.matriz, relativeTo: origen)
        if poseParaProgreso?.cercana(a: pose, metros: 0.10, grados: 10) != true {
            progreso = ProgresoRuta()
            poseParaProgreso = pose
            ultimoAviso = 0
        }
        pideQR = false
    }

    private func actualizarTramo(_ frame: ARFrame) {
        guard contenido != nil, frame.timestamp - ultimoAviso >= 0.12 else { return }
        ultimoAviso = frame.timestamp
        let ruta = marcoRuta.transformMatrix(relativeTo: nil)
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
        ultimoAviso = 0
    }

    private func pausarGuia() {
        marcoQR.isEnabled = false
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
