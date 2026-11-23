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
    struct PuntoPantalla: Encodable, Equatable {
        let x: Double
        let y: Double
    }

    let anclaId: String?
    let fiable: Bool
    let mensaje: String
    let tramo: Tramo?
    let rumbo: Double?
    let destino: PuntoPantalla?
    let destinoId: Int?
}

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var estado = "🔍 Busca el QR del ancla"
    @Published private(set) var tramoActual: String?
    @Published private(set) var rumboGrados: Double?
    @Published private(set) var destinoEnPantalla: EstadoAR.PuntoPantalla?
    @Published private(set) var desdeCaraOpuesta = false
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
    private var anclajeSubancla = AnclajeQR()
    private var usaSubancla = false
    private var buscarTramoCercano = false
    private var poseParaProgreso: PoseQR?
    private var progreso = ProgresoRuta()
    private var ultimoAviso: TimeInterval = 0
    private var ultimaProyeccion: TimeInterval = 0
    private var sesionId = UUID()
    private var enMarcha = false
    private var interrumpida = false
    private var pideQR = true
    private var avisoImagen: String?
    private var anclaFijada: String?
    private var anclaBuscada: String?
    private var ultimoTramo: EstadoAR.Tramo?
    private var estadoEnviado: EstadoAR?
    private var destinoId: Int?

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

    func cambiarRecorrido(_ nuevo: Recorrido?, destinoId: Int? = nil) {
        if let nuevo, nuevo.anclaId != anclaFijada { return }
        recorrido = nuevo
        self.destinoId = destinoId
        progreso = ProgresoRuta()
        buscarTramoCercano = usaSubancla
        ultimoTramo = nil
        tramoActual = nil
        rumboGrados = nil
        destinoEnPantalla = nil
        ultimaProyeccion = 0
        rehacer()
        emitirEstado()
    }

    func emitirEstado() {
        guard let alCambiarEstado else { return }
        let actual = EstadoAR(anclaId: anclaFijada, fiable: enMarcha && marcoQR.isEnabled, mensaje: estado,
                             tramo: ultimoTramo, rumbo: rumboGrados, destino: destinoEnPantalla, destinoId: destinoId)
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
        anclajeSubancla = AnclajeQR()
        usaSubancla = false
        buscarTramoCercano = false
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
        let activas = anclas.values.filter { anclaBuscada == nil || $0.principalId == anclaBuscada }
        let referencias = Set(activas
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
        config.maximumNumberOfTrackedImages = activas.contains { $0.subancla != nil } ? 2 : 1
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
        dejarDeVerReferencias()
        pausarGuia()
        mostrarEstado(buscarMensaje)
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
            dejarDeVerReferencias()
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
        let principal = anclaFijada ?? anclaBuscada
        let visibles: [(ARImageAnchor, AnclaAR)] = frame.anchors.compactMap { anchor in
            guard let imagen = anchor as? ARImageAnchor, imagen.isTracked,
                  let nombre = imagen.referenceImage.name, let referencia = anclas[nombre],
                  principal == nil || principal == referencia.principalId else { return nil }
            return (imagen, referencia)
        }
        var principalVisible = false
        var mensaje = usaSubancla ? "📍 Última posición confirmada por una subancla" : "📍 Última posición del QR en el entorno"
        if let (imagen, referencia) = visibles.first(where: { $0.1.subancla == nil }) {
            anclajeSubancla.dejarDeVerQR()
            if let pose = anclaje.observar(PoseQR(imagen.transform), id: imagen.identifier, en: frame.timestamp) {
                aplicarPoseQR(pose, id: referencia.id)
                let escala = Float(imagen.estimatedScaleFactor)
                if escala.isFinite, escala > 0 { marcaQR?.scale = SIMD3<Float>(repeating: escala) }
                principalVisible = true
                mensaje = "✅ Siguiendo el QR del ancla"
            } else if !usaSubancla || pideQR {
                pausarGuia()
                mostrarEstado("Mantén el QR bien encuadrado un momento.")
                return
            }
        } else if let (imagen, referencia) = visibles.first, let subancla = referencia.subancla {
            anclaje.dejarDeVerQR()
            let muestra = PoseQR(imagen.transform)
            if muestra.matriz.columns.2.y > -0.97 {
                anclajeSubancla.dejarDeVerQR()
                mensaje = "La subancla debe estar vertical, con ARRIBA hacia el techo."
            } else if let pose = anclajeSubancla.observar(muestra, id: imagen.identifier, en: frame.timestamp) {
                guard aplicarSubancla(subancla.poseRecorrido(desde: pose), anclaId: subancla.anclaId) else {
                    pausarGuia()
                    mostrarEstado("La subancla no coincide con la calibración. Revisa sus medidas o vuelve a detectar el QR.")
                    return
                }
                mensaje = "✅ Subancla: \(subancla.nombre)"
            } else {
                mensaje = "Mantén la subancla bien encuadrada un momento."
            }
        }
        guard origen != nil, !pideQR else {
            pausarGuia()
            mostrarEstado(visibles.isEmpty ? (avisoImagen ?? buscarMensaje) : mensaje)
            return
        }
        marcoQR.isEnabled = true
        marcaQR?.isEnabled = principalVisible
        mostrarEstado(mensaje)
        actualizarVisuales(frame)
        actualizarTramo(frame)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        interrumpida = true
        dejarDeVerReferencias()
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
        guard let rutaDesdeQR = anclaje.rutaDesdeQR, let origen = prepararOrigen(id) else { return }
        marcaQR?.setTransformMatrix(pose.matriz, relativeTo: origen)
        let poseRuta = PoseQR(pose.matriz * rutaDesdeQR)
        marcoRuta.setTransformMatrix(poseRuta.matriz, relativeTo: origen)
        if poseParaProgreso?.cercana(a: poseRuta, metros: 0.10, grados: 10) != true {
            if !usaSubancla { progreso = ProgresoRuta() }
            poseParaProgreso = poseRuta
            ultimoAviso = 0
        }
        usaSubancla = false
        pideQR = false
    }

    private func prepararOrigen(_ id: String) -> AnchorEntity? {
        if let origen { return origen }
        guard let ancla = anclas[id], ancla.subancla == nil else { return nil }
        let fijo = AnchorEntity(world: SIMD3<Float>.zero)
        fijo.addChild(marcoQR)
        let marca = Contenido.marcaQR(Float(ancla.ladoCm / 100))
        marca.isEnabled = false
        marcoQR.addChild(marca)
        marcaQR = marca
        vista.scene.addAnchor(fijo)
        origen = fijo
        anclaFijada = id
        anclaBuscada = id
        rehacer()
        return fijo
    }

    private func aplicarSubancla(_ estimada: PoseQR, anclaId: String) -> Bool {
        let recolocar = pideQR || origen == nil
        guard let origen = prepararOrigen(anclaId) else { return false }
        let pose: PoseQR
        if recolocar {
            pose = estimada
            buscarTramoCercano = true
        } else {
            let anterior = PoseQR(marcoRuta.transformMatrix(relativeTo: origen))
            guard anterior.cercana(a: estimada, metros: 0.50, grados: 15) else { return false }
            pose = anterior.combinada(con: estimada, peso: 0.20)
        }
        marcoRuta.setTransformMatrix(pose.matriz, relativeTo: origen)
        poseParaProgreso = pose
        usaSubancla = true
        pideQR = false
        return true
    }

    private func dejarDeVerReferencias() {
        anclaje.dejarDeVerQR()
        anclajeSubancla.dejarDeVerQR()
    }

    private func actualizarTramo(_ frame: ARFrame) {
        guard let recorrido, contenido != nil, frame.timestamp - ultimoAviso >= 0.12 else { return }
        ultimoAviso = frame.timestamp
        let ruta = marcoRuta.transformMatrix(relativeTo: nil)
        let camara = frame.camera.transform
        if recorrido.colocacion != nil, let punto = recorrido.puntos.last {
            let vector = simd_inverse(camara) * (ruta * SIMD4<Float>(punto, 1))
            let distancia = simd_length(SIMD3<Float>(vector.x, vector.y, vector.z))
            let texto = "Distancia al centro: \(distancia.formatted(.number.precision(.fractionLength(2)))) m"
            if tramoActual != texto { tramoActual = texto }
            actualizarRumbo(vector)
            return
        }
        let local = simd_inverse(ruta) * camara.columns.3
        if buscarTramoCercano {
            progreso.ubicarTramo(puntos: recorrido.puntos, posicion: [local.x, local.y, local.z])
            buscarTramoCercano = false
        }
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
            actualizarRumbo(direccion)
        }
    }

    private func actualizarRumbo(_ direccion: SIMD4<Float>) {
        let grados = atan2(Double(direccion.x), Double(-direccion.z)) * 180 / .pi
        let rumbo = (grados / 5).rounded() * 5
        if rumboGrados != rumbo { rumboGrados = rumbo }
    }

    private func actualizarVisuales(_ frame: ARFrame) {
        guard let recorrido, let contenido else { return }
        let pantalla = vista.bounds.size
        guard pantalla.width > 1, pantalla.height > 1 else { return }
        let mundo = marcoRuta.transformMatrix(relativeTo: nil)
        let inversaCamara = simd_inverse(frame.camera.transform)
        if let colocacion = recorrido.colocacion, let punto = recorrido.puntos.last {
            let camaraLocal = simd_inverse(mundo) * frame.camera.transform.columns.3
            let visible = colocacion.seVe(desde: [camaraLocal.x, camaraLocal.y, camaraLocal.z], punto: punto)
            contenido.findEntity(named: "marcaColocacion")?.isEnabled = visible
            let caraOpuesta = !visible
            if desdeCaraOpuesta != caraOpuesta { desdeCaraOpuesta = caraOpuesta }
            if !visible {
                if destinoEnPantalla != nil { destinoEnPantalla = nil }
                return
            }
        }
        if recorrido.flechas && !soloLinea {
            let localACamara = inversaCamara * mundo
            let proyeccion = frame.camera.projectionMatrix(for: .portrait, viewportSize: pantalla, zNear: 0.05, zFar: 50)
            for flecha in contenido.children where flecha.name == "flecha" {
                let profundidad = -(localACamara * SIMD4<Float>(flecha.position, 1)).z
                let escala = GeometriaFlecha.escala(profundidad: profundidad,
                    altoPantalla: Float(pantalla.height), anchoPantalla: Float(pantalla.width),
                    proyeccionY: max(1, abs(proyeccion.columns.1.y)))
                flecha.isEnabled = escala > 0
                if escala > 0 { flecha.scale = SIMD3<Float>(repeating: escala) }
            }
        }
        guard frame.timestamp - ultimaProyeccion >= 0.04 else { return }
        ultimaProyeccion = frame.timestamp
        var destino: EstadoAR.PuntoPantalla?
        if recorrido.icono, let punto = recorrido.posIcono ?? recorrido.puntos.last {
            let altura: Float = recorrido.colocacion == nil ? 0.025 : 0
            let p = mundo * SIMD4<Float>(punto + [0, altura, 0], 1)
            if (inversaCamara * p).z < -0.05 {
                let proyectado = frame.camera.projectPoint([p.x, p.y, p.z], orientation: .portrait, viewportSize: pantalla)
                let x = Double(proyectado.x / pantalla.width)
                let y = Double(proyectado.y / pantalla.height)
                if (0.0...1.0).contains(x), (0.0...1.0).contains(y) {
                    destino = .init(x: (x * 1000).rounded() / 1000, y: (y * 1000).rounded() / 1000)
                }
            }
        }
        if destino != destinoEnPantalla { destinoEnPantalla = destino }
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
        if destinoEnPantalla != nil { destinoEnPantalla = nil }
        if tramoActual != nil { tramoActual = nil }
        if rumboGrados != nil { rumboGrados = nil }
        if desdeCaraOpuesta { desdeCaraOpuesta = false }
    }

    private func mostrarEstado(_ texto: String) {
        if estado != texto { estado = texto }
    }

    private var buscarMensaje: String {
        if let recorrido, recorrido.colocacion != nil {
            return "🔍 Enfoca el QR principal (\(recorrido.anclaId))"
        }
        if anclas.values.contains(where: { $0.subancla != nil && (anclaBuscada == nil || $0.principalId == anclaBuscada) }) {
            return "🔍 Busca el QR principal o una subancla de la máquina"
        }
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
