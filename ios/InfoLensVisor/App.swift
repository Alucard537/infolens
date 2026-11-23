import SwiftUI

@main
struct InfoLensApp: App {
    @StateObject private var aplicacion = AplicacionInfoLens()

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                if let controlador = aplicacion.controlador {
                    VistaAR(controlador: controlador)
                        .id(ObjectIdentifier(controlador))
                        .ignoresSafeArea()
                }
                WebInfoLens(aplicacion: aplicacion)
                    .ignoresSafeArea()
                    .opacity(aplicacion.pruebaAbierta ? 0 : 1)
                    .allowsHitTesting(!aplicacion.pruebaAbierta)
                if aplicacion.pruebaAbierta, let controlador = aplicacion.controlador {
                    PanelPrueba(controlador: controlador, cerrar: aplicacion.cerrar)
                }
            }
            .onOpenURL { url in
                if let recorrido = Recorrido.desdeURL(url) { aplicacion.abrirPrueba(recorrido) }
                else { aplicacion.error = "Ese enlace no contiene un recorrido válido." }
            }
            .alert("InfoLens", isPresented: Binding(
                get: { aplicacion.error != nil },
                set: { if !$0 { aplicacion.error = nil } }
            )) {
                Button("Aceptar", role: .cancel) {}
            } message: {
                Text(aplicacion.error ?? "")
            }
        }
    }
}

private struct PanelPrueba: View {
    @ObservedObject var controlador: ControladorAR
    let cerrar: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text(controlador.estado)
                .font(.subheadline.weight(.semibold))
                .padding(10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            Spacer()
            VStack(alignment: .leading, spacing: 8) {
                Text(controlador.recorrido?.info.nombre ?? "Prueba del recorrido").font(.headline)
                if let referencia = controlador.recorrido?.info.referencia {
                    Text(referencia).font(.subheadline)
                }
                if let tramo = controlador.tramoActual { Text(tramo).font(.subheadline) }
                Picker("Mostrar", selection: $controlador.soloLinea) {
                    Text("Flechas").tag(false)
                    Text("Línea").tag(true)
                }
                .pickerStyle(.segmented)
                HStack {
                    Button("Volver a detectar QR") { controlador.buscarQR() }.buttonStyle(.bordered)
                    Spacer()
                    Button("Cerrar", action: cerrar).buttonStyle(.borderedProminent)
                }
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        }
        .padding(12)
    }
}
