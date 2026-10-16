// Sesión de ARKit: seguimiento del mundo (con LiDAR si el iPhone lo tiene) + detección y SEGUIMIENTO
// del QR del ancla. Cuando ARKit encuentra el QR, el recorrido se engancha a él: si el QR se mueve o se
// gira, el recorrido se mueve y gira con él; si deja de verse, se queda en su sitio (LiDAR).
import ARKit
import Combine
import RealityKit
import SwiftUI

final class ControladorAR: NSObject, ObservableObject, ARSessionDelegate {
    @Published var estado = "🔍 Busca el QR del ancla"
    @Published var detectado = false
    @Published var soloLinea: Bool { didSet { rehacer() } }
    @Published var giro: Int { didSet { rehacer() } }

    let vista = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    let recorrido: Recorrido
    private var ancla: AnchorEntity?
    private var contenido: Entity?
    private var ladoM: Float = 0.1

    init(recorrido: Recorrido) {
        self.recorrido = recorrido
        self.soloLinea = recorrido.soloLinea
        self.giro = recorrido.giro
        super.init()
        vista.session.delegate = self
        arrancar()
    }

    func arrancar() {
        ancla.map { vista.scene.removeAnchor($0) }
        ancla = nil; contenido = nil; detectado = false
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) { config.sceneReconstruction = .mesh }
        if let ref = ImagenQR.referencia(para: recorrido) {
            config.detectionImages = [ref]
            config.maximumNumberOfTrackedImages = 1
            ref.validate { [weak self] error in
                guard let error else { return }
                DispatchQueue.main.async { self?.estado = "⚠️ ARKit avisa del QR: \(error.localizedDescription)" }
            }
            estado = "🔍 Busca el QR del ancla (\(recorrido.anclaId))"
        } else {
            estado = "❌ No se pudo preparar la imagen del QR"
        }
        vista.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func detener() { vista.session.pause() }

    // MARK: ARSessionDelegate
    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        for a in anchors { if let img = a as? ARImageAnchor { colocar(img) } }
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        for a in anchors {
            guard let img = a as? ARImageAnchor else { continue }
            if ancla == nil { colocar(img) }
            let texto = img.isTracked ? "✅ QR enganchado: el recorrido sigue al QR" : "📍 QR fuera de la vista: el recorrido se queda en su sitio"
            if estado != texto { estado = texto }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        estado = "❌ AR: \(error.localizedDescription)"
    }

    private func colocar(_ img: ARImageAnchor) {
        guard ancla == nil else { return }
        ladoM = Float(img.referenceImage.physicalSize.width)
        let a = AnchorEntity(anchor: img)
        vista.scene.addAnchor(a)
        ancla = a
        detectado = true
        rehacer()
    }

    private func rehacer() {
        guard let ancla else { return }
        contenido?.removeFromParent()
        let c = Contenido.crear(recorrido, ladoM: ladoM, soloLinea: soloLinea)
        // QR en la pared: el "arriba" del recorrido es el borde de arriba del QR (no la cara del QR)
        var q = simd_quatf(angle: Float(giro) * .pi / 180, axis: [0, 1, 0])
        if recorrido.enPared { q = q * simd_quatf(angle: -.pi / 2, axis: [1, 0, 0]) }
        c.orientation = q
        ancla.addChild(c)
        contenido = c
    }
}

struct VistaAR: UIViewRepresentable {
    let controlador: ControladorAR
    func makeUIView(context: Context) -> ARView { controlador.vista }
    func updateUIView(_ uiView: ARView, context: Context) {}
}
