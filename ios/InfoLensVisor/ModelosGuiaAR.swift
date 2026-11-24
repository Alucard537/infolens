import Foundation
import RealityKit
import SwiftUI
import WebKit
import simd

struct ModeloGuiaAR: Codable {
    let id: String
    let archivoId: String
    let anclaId: String
    let nombre: String?
    var pos: [Float]
    var rotacion: [Float]
    var escala: Float

    var valido: Bool {
        UUID(uuidString: id) != nil && UUID(uuidString: archivoId) != nil && (1...80).contains(anclaId.count) &&
        pos.count == 3 && pos.allSatisfy { $0.isFinite && abs($0) <= 100 } &&
        rotacion.count == 3 && rotacion.allSatisfy { $0.isFinite && abs($0) <= 3600 } &&
        (0.01...100).contains(escala)
    }

    var transformacion: Transform {
        let a = rotacion.map { $0 * .pi / 180 }
        let giro = simd_quatf(angle: a[1], axis: [0, 1, 0]) * simd_quatf(angle: a[0], axis: [1, 0, 0]) * simd_quatf(angle: a[2], axis: [0, 0, 1])
        return Transform(scale: .init(repeating: escala), rotation: giro, translation: [pos[0], pos[1], pos[2]])
    }
}

@MainActor
final class ArchivosModelosAR {
    private let carpeta = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)

    deinit { try? FileManager.default.removeItem(at: carpeta) }

    func archivo(_ id: String, web: WKWebView) async throws -> URL {
        guard UUID(uuidString: id) != nil else { throw CocoaError(.fileReadCorruptFile) }
        let fs = FileManager.default
        try fs.createDirectory(at: carpeta, withIntermediateDirectories: true)
        let destino = carpeta.appendingPathComponent(id + ".usdz")
        if fs.fileExists(atPath: destino.path) { return destino }
        let temporal = carpeta.appendingPathComponent(UUID().uuidString)
        guard fs.createFile(atPath: temporal.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        defer { try? fs.removeItem(at: temporal) }
        let salida = try FileHandle(forWritingTo: temporal)
        defer { try? salida.close() }
        var leidos = 0
        var total: Int?
        repeat {
            try Task.checkCancellation()
            let resultado: Any = try await withCheckedThrowingContinuation { continuation in
                web.callAsyncJavaScript("return await window.infolensParteModelo(archivo, desde);",
                    arguments: ["archivo": id, "desde": leidos], in: nil, in: .page,
                    completionHandler: { continuation.resume(with: $0) })
            }
            try Task.checkCancellation()
            guard let parte = resultado as? [String: Any], let longitud = parte["tam"] as? Int,
                  (1...32 * 1024 * 1024).contains(longitud), total == nil || total == longitud,
                  let cadena = parte["datos"] as? String, cadena.count <= 512 * 1024,
                  let bytes = Data(base64Encoded: cadena), !bytes.isEmpty, leidos + bytes.count <= longitud else {
                throw CocoaError(.fileReadCorruptFile)
            }
            if leidos == 0 && !bytes.starts(with: [0x50, 0x4b, 0x03, 0x04]) { throw CocoaError(.fileReadCorruptFile) }
            try salida.write(contentsOf: bytes)
            leidos += bytes.count
            total = longitud
        } while leidos < (total ?? 0)
        try salida.synchronize()
        if !fs.fileExists(atPath: destino.path) { try fs.moveItem(at: temporal, to: destino) }
        return destino
    }
}

struct PanelColocacionModelo: View {
    @ObservedObject var aplicacion: AplicacionInfoLens
    @ObservedObject var controlador: ControladorAR
    @State private var ajuste = 0
    @State private var eje = 0

    var body: some View {
        ZStack {
            ZStack {
                Color.clear
                Image(systemName: "plus").font(.title2.weight(.semibold))
                    .foregroundColor(.white).shadow(color: .black, radius: 3)
            }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
            VStack(spacing: 12) {
                Text(controlador.estado).font(.subheadline.weight(.semibold))
                    .padding(9).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                Spacer()
                if let modelo = aplicacion.modeloEnEdicion { panel(modelo) }
            }
            .padding(12)
        }
    }

    private func panel(_ modelo: ModeloGuiaAR) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(modelo.nombre ?? "Colocar modelo 3D").font(.headline).lineLimit(1)
            if let aviso = aplicacion.avisoModelo { Text(aviso).font(.footnote).foregroundStyle(.orange) }
            if aplicacion.modeloListo {
                Button("Marcar en la mira") { aplicacion.marcarModelo() }
                    .buttonStyle(.borderedProminent).disabled(!controlador.modeloPuedeColocarse)
                Picker("Ajuste del modelo", selection: $ajuste) {
                    Text("Mover").tag(0)
                    Text("Girar").tag(1)
                    Text("Tamaño").tag(2)
                }.pickerStyle(.segmented)
                if ajuste < 2 {
                    Picker("Eje", selection: $eje) {
                        Text(ajuste == 0 ? "Derecha" : "X").tag(0)
                        Text(ajuste == 0 ? "Arriba" : "Y").tag(1)
                        Text(ajuste == 0 ? "Adelante" : "Z").tag(2)
                    }.pickerStyle(.segmented)
                }
                HStack {
                    Button { cambiar(modelo, -1) } label: { Image(systemName: "minus").frame(width: 32, height: 26) }
                        .accessibilityLabel("Disminuir")
                    Spacer()
                    Text(valor(modelo)).monospacedDigit()
                    Spacer()
                    Button { cambiar(modelo, 1) } label: { Image(systemName: "plus").frame(width: 32, height: 26) }
                        .accessibilityLabel("Aumentar")
                }.buttonStyle(.bordered).disabled(!controlador.modeloPuedeColocarse)
            } else if aplicacion.avisoModelo == nil { ProgressView("Cargando modelo…") }
            HStack {
                Button("Cancelar", role: .cancel) { aplicacion.terminarModelo(guardar: false) }.buttonStyle(.bordered)
                Spacer()
                Button("Usar colocación") { aplicacion.terminarModelo(guardar: true) }.buttonStyle(.borderedProminent)
                    .disabled(!aplicacion.modeloListo || !controlador.modeloPuedeColocarse)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    private func valor(_ m: ModeloGuiaAR) -> String {
        if ajuste == 2 { return "\((m.escala * 100).formatted(.number.precision(.fractionLength(0)))) %" }
        if ajuste == 1 { return "\(m.rotacion[eje].formatted(.number.precision(.fractionLength(0))))°" }
        let cm = m.pos[eje] * (eje == 2 ? -100 : 100)
        return "\(cm.formatted(.number.precision(.fractionLength(1)))) cm"
    }

    private func cambiar(_ modelo: ModeloGuiaAR, _ sentido: Float) {
        var m = modelo
        if ajuste == 2 { m.escala = min(100, max(0.01, m.escala * (sentido > 0 ? 1.1 : 1 / 1.1))) }
        else if ajuste == 1 { m.rotacion[eje] = (m.rotacion[eje] + sentido * 5).truncatingRemainder(dividingBy: 360) }
        else { m.pos[eje] = min(100, max(-100, m.pos[eje] + sentido * (eje == 2 ? -0.02 : 0.02))) }
        aplicacion.ajustarModelo(m)
    }
}
