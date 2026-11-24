// La ruta es hija del QR. ARKit conserva su última posición en el mundo mientras el QR no se ve.
import ARKit
import AVFoundation
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

        static func enPantalla(x: Double, y: Double) -> PuntoPantalla? {
            guard (0.0...1.0).contains(x), (0.0...1.0).contains(y) else { return nil }
            return .init(x: (x * 1000).rounded() / 1000, y: (y * 1000).rounded() / 1000)
        }
    }
    struct ElementoVisible: Encodable, Equatable {
        let id: Int
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
    let errorDestino: String?
    let direccionDestino: DireccionDestino?
    let elementos: [ElementoVisible]?
    let linternaDisponible: Bool
    let linternaEncendida: Bool
    let errorLinterna: String?
}

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published private(set) var estado = "🔍 Busca el QR del ancla"
    @Published private(set) var tramoActual: String?
    @Published private(set) var rumboGrados: Double?
    @Published private(set) var destinoEnPantalla: EstadoAR.PuntoPantalla?
    @Published private(set) var desdeCaraOpuesta = false
    @Published private(set) var medicionSubancla: MedicionSubancla?
    @Published var soloLinea: Bool { didSet { rehacer() } }
    var alCambiarEstado: ((EstadoAR) -> Void)?

    let vista = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    private(set) var recorrido: Recorrido?
    private let anclas: [String: AnclaAR]
    let subanclaParaCalibrar: AnclaAR?
    private let marcoQR = Entity()
    private let marcoRuta = Entity()
    private var marcaQR: Entity?
    private let marcaTramo = Contenido.bola(0.035, Contenido.oro)
    private var origen: AnchorEntity?
    private var contenido: Entity?
    private var anclaje = AnclajeQR()
    private var anclajeSubancla = AnclajeQR()
    private var usaSubancla = false
    private var baseAjusteSubancla: (id: String, pose: PoseQR)?
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
    private var errorDestino: String?
    private var direccionDestino: DireccionDestino?
    private var elementosGuia: ElementosDeGuia?
    private var elementosEnPantalla: [EstadoAR.ElementoVisible]?
    private lazy var dispositivoLinterna: AVCaptureDevice? = {
        if let dispositivo = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera, dispositivo.hasTorch {
            return dispositivo
        }
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }()
    private var linternaSolicitada = false
    private var errorLinterna: String?

    init(recorrido: Recorrido) {
        self.anclas = [recorrido.anclaId: recorrido.ancla]
        self.subanclaParaCalibrar = nil
        self.recorrido = recorrido
        self.soloLinea = recorrido.soloLinea
        super.init()
        configurar()
    }

    init(anclas: [AnclaAR], soloLinea: Bool, calibrar: AnclaAR? = nil) {
        self.anclas = Dictionary(anclas.filter(\.valida).map { ($0.id, $0) }, uniquingKeysWith: { primera, _ in primera })
        self.subanclaParaCalibrar = calibrar
        self.anclaBuscada = calibrar?.principalId
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

    func cambiarRecorrido(_ nuevo: Recorrido?, elementos: ElementosDeGuia? = nil, destinoId: Int? = nil, error: String? = nil) {
        let anclaActual = anclaFijada ?? anclaBuscada
        let desdeVistaElementos = elementosGuia != nil
        let anclaSolicitada = nuevo?.anclaId ?? elementos?.anclaId
        if let anclaSolicitada, anclas[anclaSolicitada]?.subancla != nil || anclas[anclaSolicitada] == nil ||
            (anclaActual != nil && anclaActual != anclaSolicitada) {
            recorrido = nil
            elementosGuia = nil
            errorDestino = "La posición del elemento corresponde a otro QR principal."
        } else {
            recorrido = nuevo
            elementosGuia = elementos
            errorDestino = error
            if let anclaSolicitada, anclaFijada == nil { anclaBuscada = anclaSolicitada }
        }
        self.destinoId = destinoId
        progreso = ProgresoRuta()
        buscarTramoCercano = usaSubancla || desdeVistaElementos
        ultimoTramo = nil
        tramoActual = nil
        rumboGrados = nil
        destinoEnPantalla = nil
        direccionDestino = nil
        elementosEnPantalla = nil
        if elementosGuia != nil { marcaQR?.isEnabled = false }
        ultimaProyeccion = 0
        rehacer()
        emitirEstado()
    }

    func emitirEstado(forzar: Bool = false) {
        guard let alCambiarEstado else { return }
        let linternaDisponible = enMarcha && !interrumpida && dispositivoLinterna?.hasTorch == true
        let actual = EstadoAR(anclaId: anclaFijada, fiable: enMarcha && marcoQR.isEnabled, mensaje: estado,
                             tramo: ultimoTramo, rumbo: rumboGrados, destino: destinoEnPantalla, destinoId: destinoId,
                             errorDestino: errorDestino, direccionDestino: direccionDestino, elementos: elementosEnPantalla,
                             linternaDisponible: linternaDisponible, linternaEncendida: linternaDisponible && dispositivoLinterna?.isTorchActive == true,
                             errorLinterna: errorLinterna)
        guard forzar || actual != estadoEnviado else { return }
        estadoEnviado = actual
        alCambiarEstado(actual)
    }

    private func arrancar() {
        defer { emitirEstado() }
        apagarLinterna()
        if let origen { vista.scene.removeAnchor(origen) }
        marcoQR.removeFromParent()
        origen = nil
        anclaFijada = nil
        marcaQR?.removeFromParent()
        marcaQR = nil
        anclaje = AnclajeQR()
        anclajeSubancla = AnclajeQR()
        usaSubancla = false
        baseAjusteSubancla = nil
        medicionSubancla = nil
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
        if subanclaParaCalibrar != nil || !enMarcha || interrumpida {
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
        apagarLinterna()
        enMarcha = false
        sesionId = UUID()
        vista.session.pause()
    }

    func cambiarLinterna(encendida: Bool) {
        defer { emitirEstado(forzar: true) }
        guard enMarcha, !interrumpida, let dispositivo = dispositivoLinterna, dispositivo.hasTorch else {
            errorLinterna = "La linterna no está disponible."
            return
        }
        let modo: AVCaptureDevice.TorchMode = encendida ? .on : .off
        guard (!encendida || dispositivo.isTorchAvailable), dispositivo.isTorchModeSupported(modo) else {
            errorLinterna = "La cámara no puede cambiar la linterna ahora."
            return
        }
        do {
            try configurarLinterna(dispositivo, modo: modo)
            linternaSolicitada = encendida
            errorLinterna = nil
        } catch {
            errorLinterna = "La cámara no pudo cambiar la linterna."
        }
    }

    private func configurarLinterna(_ dispositivo: AVCaptureDevice, modo: AVCaptureDevice.TorchMode) throws {
        try dispositivo.lockForConfiguration()
        defer { dispositivo.unlockForConfiguration() }
        dispositivo.torchMode = modo
    }

    private func apagarLinterna() {
        errorLinterna = nil
        guard linternaSolicitada, let dispositivo = dispositivoLinterna, dispositivo.isTorchModeSupported(.off) else { return }
        do {
            try configurarLinterna(dispositivo, modo: .off)
            linternaSolicitada = false
        } catch {
            // Al liberar la cámara, iOS apaga su linterna.
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard enMarcha, !interrumpida, medicionSubancla == nil else { return }
        defer { emitirEstado() }
        guard case .normal = frame.camera.trackingState else {
            dejarDeVerReferencias()
            pausarGuia()
            let mensaje: String
            switch frame.camera.trackingState {
            case .limited(.relocalizing):
                if subanclaParaCalibrar != nil, origen != nil { arrancar(); return }
                mensaje = "Recuperando la posición. Apunta a la zona donde se fijó el QR."
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
        let subVisible = visibles.first(where: { $0.1.subancla != nil })
        if let (imagen, referencia) = visibles.first(where: { $0.1.subancla == nil }),
           subanclaParaCalibrar == nil || origen == nil || subVisible == nil {
            anclajeSubancla.dejarDeVerQR()
            let muestra = PoseQR(imagen.transform)
            if let orientacion = referencia.orientacion, !orientacion.coincide(con: muestra) {
                anclaje.dejarDeVerQR()
                mensaje = orientacion.instruccion
            } else if let pose = anclaje.observar(muestra, id: imagen.identifier, en: frame.timestamp, orientacion: referencia.orientacion) {
                aplicarPoseQR(pose, id: referencia.id)
                let escala = Float(imagen.estimatedScaleFactor)
                if escala.isFinite, escala > 0 { marcaQR?.scale = SIMD3<Float>(repeating: escala) }
                principalVisible = true
                if let nombre = subanclaParaCalibrar?.subancla?.nombre {
                    mensaje = "Principal fijado. Enfoca «\(nombre)»."
                } else {
                    mensaje = "✅ Siguiendo el QR del ancla"
                }
            } else if !usaSubancla || pideQR {
                pausarGuia()
                mostrarEstado("Mantén el QR bien encuadrado un momento.")
                return
            }
        } else if let (imagen, referencia) = subVisible, let subancla = referencia.subancla {
            guard let origen, !pideQR else {
                pausarGuia()
                mostrarEstado(buscarMensaje)
                return
            }
            anclaje.dejarDeVerQR()
            let muestra = PoseQR(imagen.transform)
            if !subancla.montaje.coincide(con: muestra) {
                anclajeSubancla.dejarDeVerQR()
                mensaje = subancla.montaje.instruccion
            } else if let pose = anclajeSubancla.observar(muestra, id: imagen.identifier, en: frame.timestamp, orientacion: subancla.montaje) {
                if subanclaParaCalibrar != nil {
                    medicionSubancla = MedicionSubancla(principal: marcoRuta.transformMatrix(relativeTo: origen), subancla: pose,
                                                       montaje: subancla.montaje)
                    mensaje = medicionSubancla == nil ? "Acerca la cámara al QR para medirlo." : "Medición lista. Comprueba y guarda."
                } else {
                    mensaje = ajustarConSubancla(subancla, observada: pose, id: referencia.id, origen: origen)
                }
            } else {
                mensaje = "Mantén la subancla bien encuadrada un momento."
            }
        }
        guard origen != nil, !pideQR else {
            pausarGuia()
            mostrarEstado(visibles.isEmpty ? (avisoImagen ?? buscarMensaje) : mensaje)
            return
        }
        if let subancla = subanclaParaCalibrar?.subancla, visibles.isEmpty {
            mensaje = "Principal fijado. Enfoca «\(subancla.nombre)»."
        }
        marcoQR.isEnabled = true
        marcaQR?.isEnabled = principalVisible && elementosGuia == nil
        mostrarEstado(mensaje)
        actualizarVisuales(frame)
        actualizarTramo(frame)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        interrumpida = true
        apagarLinterna()
        dejarDeVerReferencias()
        pausarGuia()
        mostrarEstado("Guía en pausa. Esperando a que vuelva la cámara.")
        emitirEstado()
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        interrumpida = false
        if subanclaParaCalibrar != nil, medicionSubancla == nil { arrancar() }
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    func session(_ session: ARSession, didFailWithError error: Error) {
        apagarLinterna()
        enMarcha = false
        pausarGuia()
        mostrarEstado("❌ AR: \(error.localizedDescription)")
        emitirEstado()
    }

    private func aplicarPoseQR(_ pose: PoseQR, id: String) {
        guard let poseRuta = anclaje.poseRecorrido, let origen = prepararOrigen(id) else { return }
        marcaQR?.setTransformMatrix(pose.matriz, relativeTo: origen)
        marcoRuta.setTransformMatrix(poseRuta.matriz, relativeTo: origen)
        if poseParaProgreso?.cercana(a: poseRuta, metros: 0.10, grados: 10) != true {
            if !usaSubancla { progreso = ProgresoRuta() }
            poseParaProgreso = poseRuta
            ultimoAviso = 0
        }
        usaSubancla = false
        baseAjusteSubancla = nil
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

    private func ajustarConSubancla(_ subancla: SubanclaAR, observada: PoseQR, id: String, origen: AnchorEntity) -> String {
        let anterior = PoseQR(marcoRuta.transformMatrix(relativeTo: origen))
        let base = baseAjusteSubancla.flatMap { $0.id == id ? $0.pose : nil } ?? anterior
        let caraPrincipal = anclas[subancla.anclaId]?.cara
        let nominal = subancla.poseRecorrido(desde: observada, respectoA: caraPrincipal)
        var estimada = subancla.poseConRumboFijado(observada: observada, nominal: nominal, base: base) ?? nominal
        if !base.cercana(a: estimada, metros: 0.50, grados: 15),
           let posePrincipal = anclaje.poseRecorrido,
           let verificada = subancla.poseConCaraOpuesta(desde: observada, respectoA: caraPrincipal,
                                                        principalMedido: posePrincipal) {
            estimada = verificada
        }
        guard base.cercana(a: estimada, metros: 0.50, grados: 15),
              anterior.cercana(a: estimada, metros: 0.50, grados: 15) else {
            let desfase = simd_distance(observada.posicion, subancla.centro(en: base))
            let cm = ((desfase * 20).rounded() * 5).formatted(.number.precision(.fractionLength(0)))
            let grados = ((base.diferenciaAngular(con: nominal) / 5).rounded() * 5).formatted(.number.precision(.fractionLength(0)))
            return "⚠️ \(subancla.nombre) no coincide (\(cm) cm · \(grados)°). Guía con la última posición."
        }
        let pose = anterior.combinada(con: estimada, peso: 0.20)
        baseAjusteSubancla = (id, base)
        marcoRuta.setTransformMatrix(pose.matriz, relativeTo: origen)
        poseParaProgreso = pose
        usaSubancla = true
        return "✅ Subancla: \(subancla.nombre)"
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
        let vistaCamara = frame.camera.viewMatrix(for: .portrait)
        if recorrido.colocacion != nil, let punto = recorrido.puntos.last {
            let vector = vistaCamara * (ruta * SIMD4<Float>(punto, 1))
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
            if recorrido.icono, destinoEnPantalla == nil, let fin = recorrido.posIcono ?? recorrido.puntos.last {
                actualizarRumbo(vistaCamara * (ruta * SIMD4<Float>(fin, 1)))
            } else if rumboGrados != nil { rumboGrados = nil }
        } else {
            let direccion = vistaCamara * (ruta * SIMD4<Float>(objetivo, 1))
            actualizarRumbo(direccion)
        }
    }

    private func actualizarRumbo(_ direccion: SIMD4<Float>) {
        let grados = atan2(Double(direccion.x), Double(-direccion.z)) * 180 / .pi
        let rumbo = (grados / 5).rounded() * 5
        if rumboGrados != rumbo { rumboGrados = rumbo }
    }

    private func actualizarVisuales(_ frame: ARFrame) {
        guard elementosGuia != nil || recorrido != nil && contenido != nil else { return }
        let pantalla = vista.bounds.size
        guard pantalla.width > 1, pantalla.height > 1 else { return }
        let mundo = marcoRuta.transformMatrix(relativeTo: nil)
        let inversaCamara = frame.camera.viewMatrix(for: .portrait)
        if let elementosGuia {
            guard frame.timestamp - ultimaProyeccion >= 0.04 else { return }
            ultimaProyeccion = frame.timestamp
            elementosEnPantalla = elementosGuia.puntos.compactMap { punto in
                let p = mundo * punto.centro
                guard (inversaCamara * p).z < -0.05 else { return nil }
                let proyeccion = frame.camera.projectPoint([p.x, p.y, p.z], orientation: .portrait, viewportSize: pantalla)
                guard let visible = EstadoAR.PuntoPantalla.enPantalla(x: Double(proyeccion.x / pantalla.width),
                                                                       y: Double(proyeccion.y / pantalla.height)) else { return nil }
                return .init(id: punto.id, x: visible.x, y: visible.y)
            }
            return
        }
        guard let recorrido, let contenido else { return }
        if let colocacion = recorrido.colocacion, let punto = recorrido.puntos.last {
            let camaraLocal = simd_inverse(mundo) * frame.camera.transform.columns.3
            let visible = colocacion.seVe(desde: [camaraLocal.x, camaraLocal.y, camaraLocal.z], punto: punto,
                                          respectoA: recorrido.ancla.cara)
            contenido.findEntity(named: "marcaColocacion")?.isEnabled = visible
            let caraOpuesta = !visible
            if desdeCaraOpuesta != caraOpuesta { desdeCaraOpuesta = caraOpuesta }
            if !visible {
                if destinoEnPantalla != nil { destinoEnPantalla = nil }
                direccionDestino = nil
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
        var direccion: DireccionDestino?
        if recorrido.icono, let punto = recorrido.posIcono ?? recorrido.puntos.last {
            let altura: Float = recorrido.colocacion == nil ? 0.025 : 0
            let p = mundo * SIMD4<Float>(punto + [0, altura, 0], 1)
            let enCamara = inversaCamara * p
            if enCamara.z < -0.05 {
                let proyectado = frame.camera.projectPoint([p.x, p.y, p.z], orientation: .portrait, viewportSize: pantalla)
                let x = Double(proyectado.x / pantalla.width)
                let y = Double(proyectado.y / pantalla.height)
                if let visible = EstadoAR.PuntoPantalla.enPantalla(x: x, y: y) {
                    destino = visible
                } else {
                    direccion = DireccionDestino.enPantalla(x: x, y: y)
                }
            } else {
                direccion = DireccionDestino.fueraDelPlano(lateral: enCamara.x, profundidad: -enCamara.z)
            }
        }
        if destino != destinoEnPantalla { destinoEnPantalla = destino }
        direccionDestino = direccion
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
        direccionDestino = nil
        elementosEnPantalla = nil
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
            return "🔍 Enfoca primero el QR principal de la máquina"
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
