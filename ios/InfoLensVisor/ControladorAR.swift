// La ruta es hija del QR. ARKit conserva su última posición en el mundo mientras el QR no se ve.
import ARKit
import Combine
import RealityKit
import SwiftUI
import simd

struct EstadoAR: Encodable, Equatable {
    struct Tramo: Encodable, Equatable {
        let indice: Int
        let total: Int
        let distancia: Double
        let llegada: Bool
    }

    let anclaId: String?
    let fiable: Bool
    let mensaje: String
    let tramo: Tramo?
    let rumbo: Double?
}

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var estado = "🔍 Busca el QR del ancla"
    @Published private(set) var tramoActual: String?
    @Published private(set) var rumboGrados: Double?
    @Published var soloLinea: Bool { didSet { rehacer() } }
    var alCambiarEstado: ((EstadoAR) -> Void)?

    let vista = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    private(set) var recorrido: Recorrido?
    private let anclas: [String: AnclaAR]
    private let marcoQR = Entity()
    private let marcoRuta = Entity()
    private var marcaQR: Entity?
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
    private var anclaFijada: String?
    private var anclaBuscada: String?
    private var ultimoTramo: EstadoAR.Tramo?
    private var estadoEnviado: EstadoAR?

    init(recorrido: Recorrido) {
        self.anclas = [recorrido.anclaId: recorrido.ancla]
        self.recorrido = recorrido
        self.soloLinea = recorrido.soloLinea
        super.init()
        configurar()
    }

    init(anclas: [AnclaAR], soloLinea: Bool) {
        self.anclas = Dictionary(anclas.filter(\.valida).map { ($0.id, $0) }, uniquingKeysWith: { primera, _ in primera })
        self.soloLinea = soloLinea
        super.init()
        configurar()
    }

    private func configurar() {
        vista.session.delegateQueue = .main
        vista.session.delegate = self
        marcoQR.addChild(marcoRuta)
        arrancar()
    }

    func cambiarRecorrido(_ nuevo: Recorrido?) {
        if let nuevo, nuevo.anclaId != anclaFijada { return }
        recorrido = nuevo
        progreso = ProgresoRuta()
        ultimoTramo = nil
        tramoActual = nil
        rumboGrados = nil
        rehacer()
        emitirEstado()
    }

    func emitirEstado() {
        guard let alCambiarEstado else { return }
        let actual = EstadoAR(anclaId: anclaFijada, fiable: enMarcha && marcoQR.isEnabled, mensaje: estado,
                             tramo: ultimoTramo, rumbo: rumboGrados)
        guard actual != estadoEnviado else { return }
        estadoEnviado = actual
        alCambiarEstado(actual)
    }

    private func arrancar() {
        defer { emitirEstado() }
        if let origen { vista.scene.removeAnchor(origen) }
        marcoQR.removeFromParent()
        origen = nil
        anclaFijada = nil
        marcaQR?.removeFromParent()
        marcaQR = nil
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
        let referencias = Set(anclas.values.filter { anclaBuscada == nil || $0.id == anclaBuscada }
            .compactMap { ImagenQR.referencia(para: $0) })
        guard !referencias.isEmpty else {
            mostrarEstado("❌ No se pudo preparar el QR del ancla.")
            return
        }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) { config.sceneReconstruction = .mesh }
        config.detectionImages = referencias
        config.maximumNumberOfTrackedImages = 1
        config.automaticImageScaleEstimationEnabled = true
        let id = sesionId
        if referencias.count == 1, let referencia = referencias.first {
            referencia.validate { [weak self] error in
                guard let error else { return }
                DispatchQueue.main.async {
                    guard let self, self.sesionId == id, self.origen == nil else { return }
                    self.avisoImagen = "⚠️ ARKit avisa del QR: \(error.localizedDescription)"
                }
            }
        }
        mostrarEstado(buscarMensaje)
        enMarcha = true
        vista.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func buscarQR() {
        defer { emitirEstado() }
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
        defer { emitirEstado() }
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
            .first { imagen in
                imagen.isTracked && (anclaFijada == nil || imagen.referenceImage.name == anclaFijada)
            }
        let poseActual = qr.flatMap { anclaje.observar(PoseQR($0.transform), id: $0.identifier, en: frame.timestamp) }
        if let qr, let poseActual, let id = qr.referenceImage.name {
            aplicarPoseQR(poseActual, id: id)
            let escala = Float(qr.estimatedScaleFactor)
            if escala.isFinite, escala > 0 { marcaQR?.scale = SIMD3<Float>(repeating: escala) }
        }
        guard origen != nil, !pideQR, qr == nil || poseActual != nil else {
            pausarGuia()
            mostrarEstado(qr == nil ? (avisoImagen ?? buscarMensaje)
                         : "Mantén el QR bien encuadrado un momento.")
            return
        }
        marcoQR.isEnabled = true
        marcaQR?.isEnabled = poseActual != nil
        mostrarEstado(qr == nil ? "📍 Última posición del QR en el entorno" : "✅ Siguiendo el QR del ancla")
        ajustarFlechas(frame)
        actualizarTramo(frame)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        interrumpida = true
        anclaje.dejarDeVerQR()
        pausarGuia()
        mostrarEstado("Guía en pausa. Esperando a que vuelva la cámara.")
        emitirEstado()
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        interrumpida = false
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    func session(_ session: ARSession, didFailWithError error: Error) {
        enMarcha = false
        pausarGuia()
        mostrarEstado("❌ AR: \(error.localizedDescription)")
        emitirEstado()
    }

    private func aplicarPoseQR(_ pose: PoseQR, id: String) {
        if origen == nil {
            guard let rutaDesdeQR = anclaje.rutaDesdeQR, let ancla = anclas[id] else { return }
            let fijo = AnchorEntity(world: SIMD3<Float>.zero)
            fijo.addChild(marcoQR)
            let marca = Contenido.marcaQR(Float(ancla.ladoCm / 100))
            marcoQR.addChild(marca)
            marcaQR = marca
            marcoRuta.setTransformMatrix(rutaDesdeQR, relativeTo: marcoQR)
            vista.scene.addAnchor(fijo)
            origen = fijo
            anclaFijada = id
            anclaBuscada = id
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
        guard let recorrido, contenido != nil, frame.timestamp - ultimoAviso >= 0.12 else { return }
        ultimoAviso = frame.timestamp
        let ruta = marcoRuta.transformMatrix(relativeTo: nil)
        let camara = frame.camera.transform
        let local = simd_inverse(ruta) * camara.columns.3
        let tramo = progreso.actualizar(puntos: recorrido.puntos, posicion: [local.x, local.y, local.z])
        ultimoTramo = .init(indice: progreso.indice, total: recorrido.puntos.count - 1,
                            distancia: Double((tramo.distancia * 10).rounded() / 10), llegada: tramo.llegada)
        let objetivo = recorrido.puntos[progreso.indice]
        let distancia = tramo.distancia.formatted(.number.precision(.fractionLength(1)))
        let texto = tramo.llegada ? "Destino en esta zona" : "Tramo \(progreso.indice) de \(recorrido.puntos.count - 1) · \(distancia) m"
        if tramoActual != texto { tramoActual = texto }
        marcaTramo.isEnabled = recorrido.flechas && !tramo.llegada
        marcaTramo.position = objetivo + [0, 0.04, 0]
        if tramo.llegada || !recorrido.flechas {
            if rumboGrados != nil { rumboGrados = nil }
        } else {
            let direccion = simd_inverse(camara) * (ruta * SIMD4<Float>(objetivo, 1))
            let grados = atan2(Double(direccion.x), Double(-direccion.z)) * 180 / .pi
            let rumbo = (grados / 5).rounded() * 5
            if rumboGrados != rumbo { rumboGrados = rumbo }
        }
    }

    private func ajustarFlechas(_ frame: ARFrame) {
        guard let contenido, !soloLinea else { return }
        let localACamara = simd_inverse(frame.camera.transform) * marcoRuta.transformMatrix(relativeTo: nil)
        for flecha in contenido.children where flecha.name == "flecha" {
            let profundidad = -(localACamara * SIMD4<Float>(flecha.position, 1)).z
            flecha.isEnabled = profundidad > 0.09
            flecha.scale = SIMD3<Float>(repeating: min(1, max(0.01, profundidad * 0.55)))
        }
    }

    private func rehacer() {
        contenido?.removeFromParent()
        contenido = nil
        guard origen != nil, let recorrido else { return }
        let c = Contenido.crear(recorrido, soloLinea: soloLinea)
        marcaTramo.removeFromParent()
        marcaTramo.isEnabled = false
        c.addChild(marcaTramo)
        marcoRuta.addChild(c)
        contenido = c
        ultimoAviso = 0
    }

    private func pausarGuia() {
        marcoQR.isEnabled = false
        ultimoTramo = nil
        if tramoActual != nil { tramoActual = nil }
        if rumboGrados != nil { rumboGrados = nil }
    }

    private func mostrarEstado(_ texto: String) {
        if estado != texto { estado = texto }
    }

    private var buscarMensaje: String {
        if let id = anclaFijada ?? (anclas.count == 1 ? anclas.keys.first : nil) {
            return "🔍 Busca el QR del ancla (\(id))"
        }
        return "🔍 Busca un QR de anclaje de la máquina"
    }
}

struct VistaAR: UIViewRepresentable {
    let controlador: ControladorAR
    func makeUIView(context: Context) -> ARView { controlador.vista }
    func updateUIView(_ uiView: ARView, context: Context) {}
}
