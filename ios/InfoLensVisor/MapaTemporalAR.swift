import ARKit
import Combine
import CoreImage
import CoreVideo
import UIKit
import simd

final class MapaTemporalAR: ObservableObject {
    enum Fase {
        case buscandoQR, grabando, guardando, relocalizando, recorriendo, midiendo
    }

    private struct Referencia {
        let pose: PoseQR
        let imagen: UIImage
        let puntosLiDAR: [SIMD3<Float>]
    }

    @Published private(set) var fase = Fase.buscandoQR
    @Published private(set) var puedeGuardar = false
    @Published private(set) var cantidadFotos = 0
    @Published private(set) var cantidadPuntos = 0
    @Published private(set) var fotoGuia: UIImage?

    let distanciaEsperada: SIMD3<Float>
    private(set) var mapa: ARWorldMap?
    private var origen: ARAnchor?
    private var fotos: [Referencia] = []
    private var ultimaFoto: TimeInterval?
    private var indiceFoto = 0
    private let contexto = CIContext()

    init(distanciaEsperada: SIMD3<Float>) {
        self.distanciaEsperada = distanciaEsperada
    }

    func comenzar(en sesion: ARSession, marco: simd_float4x4) {
        let ancla = ARAnchor(name: "InfoLens.origen-mapa-temporal", transform: marco)
        origen = ancla
        sesion.add(anchor: ancla)
        fase = .grabando
    }

    func registrar(_ frame: ARFrame) {
        let listo = frame.worldMappingStatus == .mapped
        if puedeGuardar != listo { puedeGuardar = listo }
        guard let origen else { return }
        let tiempo = frame.timestamp
        let local = simd_inverse(origen.transform) * frame.camera.transform
        let pose = PoseQR(local)
        if let ultimaFoto, let ultima = fotos.last {
            guard tiempo - ultimaFoto >= 1,
                  !ultima.pose.cercana(a: pose, metros: 0.32, grados: 22) else { return }
        }
        let imagen = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
        let escala = min(1, 480 / max(imagen.extent.width, imagen.extent.height))
        let miniatura = imagen.transformed(by: CGAffineTransform(scaleX: escala, y: escala))
        guard let pixels = contexto.createCGImage(miniatura, from: miniatura.extent) else { return }
        if fotos.count >= 24 {
            fotos = fotos.enumerated().compactMap { indice, foto in indice.isMultiple(of: 2) ? foto : nil }
        }
        fotos.append(.init(pose: pose, imagen: UIImage(cgImage: pixels), puntosLiDAR: puntos(en: frame, desde: local)))
        ultimaFoto = tiempo
        cantidadFotos = fotos.count
        cantidadPuntos = fotos.reduce(0) { $0 + $1.puntosLiDAR.count }
    }

    func iniciarGuardado() { fase = .guardando }

    func perderSeguimiento() {
        if fase == .grabando && puedeGuardar { puedeGuardar = false }
    }

    func reanudarGrabacion() {
        puedeGuardar = false
        fase = .grabando
    }

    func conservar(_ mapa: ARWorldMap) -> Bool {
        guard let origen, mapa.anchors.contains(where: { $0.identifier == origen.identifier }) else { return false }
        // El QR final de la prueba se mide al verlo en directo.
        mapa.anchors.removeAll { $0 is ARImageAnchor }
        self.mapa = mapa
        comenzarRelocalizacion()
        return true
    }

    func comenzarRelocalizacion() {
        indiceFoto = max(0, fotos.count - 1)
        fotoGuia = fotos.last?.imagen
        fase = .relocalizando
    }

    func avanzarFoto() {
        guard !fotos.isEmpty else { return }
        indiceFoto = (indiceFoto + 1) % fotos.count
        fotoGuia = fotos[indiceFoto].imagen
    }

    func recuperarOrigen(en frame: ARFrame) -> simd_float4x4? {
        guard let origen, let recuperada = frame.anchors.first(where: { $0.identifier == origen.identifier }) else { return nil }
        fase = .recorriendo
        fotoGuia = nil
        return recuperada.transform
    }

    func comenzarMedicion() {
        if fase == .recorriendo { fase = .midiendo }
    }

    func errorCm(de posicion: [Float]) -> Float {
        simd_distance(distanciaEsperada, [posicion[0], posicion[1], posicion[2]]) * 100
    }

    func borrar() {
        mapa = nil
        fotos.removeAll()
        fotoGuia = nil
        cantidadFotos = 0
        cantidadPuntos = 0
        puedeGuardar = false
        origen = nil
        ultimaFoto = nil
        indiceFoto = 0
        fase = .buscandoQR
    }

    private func puntos(en frame: ARFrame, desde pose: simd_float4x4) -> [SIMD3<Float>] {
        guard let profundidad = frame.sceneDepth, let confianza = profundidad.confidenceMap else { return [] }
        let distancias = profundidad.depthMap
        let ancho = CVPixelBufferGetWidth(distancias), alto = CVPixelBufferGetHeight(distancias)
        guard ancho == CVPixelBufferGetWidth(confianza), alto == CVPixelBufferGetHeight(confianza),
              CVPixelBufferGetPixelFormatType(distancias) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferGetPixelFormatType(confianza) == kCVPixelFormatType_OneComponent8,
              CVPixelBufferLockBaseAddress(distancias, .readOnly) == kCVReturnSuccess else { return [] }
        defer { CVPixelBufferUnlockBaseAddress(distancias, .readOnly) }
        guard CVPixelBufferLockBaseAddress(confianza, .readOnly) == kCVReturnSuccess else { return [] }
        defer { CVPixelBufferUnlockBaseAddress(confianza, .readOnly) }
        guard let distanciasBase = CVPixelBufferGetBaseAddress(distancias),
              let confianzaBase = CVPixelBufferGetBaseAddress(confianza) else { return [] }
        let camara = frame.camera
        let sx = Float(camara.imageResolution.width) / Float(ancho)
        let sy = Float(camara.imageResolution.height) / Float(alto)
        let focal = camara.intrinsics
        var resultado: [SIMD3<Float>] = []
        for y in stride(from: 4, to: alto, by: 8) {
            let profundidades = distanciasBase.advanced(by: y * CVPixelBufferGetBytesPerRow(distancias)).assumingMemoryBound(to: Float32.self)
            let niveles = confianzaBase.advanced(by: y * CVPixelBufferGetBytesPerRow(confianza)).assumingMemoryBound(to: UInt8.self)
            for x in stride(from: 4, to: ancho, by: 8) {
                guard niveles[x] == UInt8(ARConfidenceLevel.high.rawValue) else { continue }
                let z = profundidades[x]
                guard z.isFinite, z > 0 else { continue }
                let horizontal = (Float(x) * sx - focal.columns.2.x) * z / focal.columns.0.x
                let vertical = (Float(y) * sy - focal.columns.2.y) * z / focal.columns.1.y
                let punto = pose * SIMD4<Float>(horizontal, -vertical, -z, 1)
                resultado.append([punto.x, punto.y, punto.z])
            }
        }
        return resultado
    }
}
