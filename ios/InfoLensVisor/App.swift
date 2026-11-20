// InfoLens Visor: visor AR nativo (ARKit + LiDAR) para los recorridos de las guías de InfoLens.
// Se abre desde la app web con el botón "📱 Abrir en el visor nativo" (infolens://ruta?d=…).
import SwiftUI

@main
struct InfoLensVisorApp: App {
    @State private var controlador: ControladorAR?
    @State private var enlaceInvalido = false

    var body: some Scene {
        WindowGroup {
            ZStack {
                if let c = controlador {
                    PantallaAR(controlador: c) {
                        c.detener()
                        controlador = nil
                    }
                    .id(c.recorrido.clave)
                } else {
                    Bienvenida { abrir(Recorrido.prueba()) }
                }
            }
            .onOpenURL { url in
                guard let recorrido = Recorrido.desdeURL(url) else {
                    enlaceInvalido = true
                    return
                }
                abrir(recorrido)
            }
            .alert("No se pudo abrir el recorrido", isPresented: $enlaceInvalido) {
                Button("Aceptar", role: .cancel) {}
            } message: {
                Text("Vuelve a Safari, abre el paso de la guía y pulsa «Abrir en el visor nativo».")
            }
        }
    }

    private func abrir(_ recorrido: Recorrido) {
        controlador?.detener()
        controlador = ControladorAR(recorrido: recorrido)
    }
}

struct Bienvenida: View {
    let iniciarPrueba: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Text("⚓ InfoLens Visor").font(.largeTitle.bold())
            Button(action: iniciarPrueba) {
                Label("Iniciar prueba con QR", systemImage: "qrcode.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            Text("Apunta al QR de prueba TEST-1, impreso con 10 cm de lado, para ver el recorrido.")
                .multilineTextAlignment(.center)
            Text("Para seguir una guía, abre su paso en InfoLens y pulsa «Abrir en el visor nativo».")
                .font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: 420)
        .padding(28)
    }
}

struct PantallaAR: View {
    @ObservedObject var controlador: ControladorAR
    let cerrar: () -> Void

    var body: some View {
        ZStack {
            VistaAR(controlador: controlador).ignoresSafeArea()
            VStack {
                VStack(spacing: 8) {
                    Text(controlador.estado).font(.headline)
                    if let tramo = controlador.tramoActual {
                        HStack(spacing: 8) {
                            if let rumbo = controlador.rumboGrados {
                                Image(systemName: "location.north.fill")
                                    .rotationEffect(.degrees(rumbo))
                                    .foregroundColor(.yellow)
                                    .accessibilityHidden(true)
                            }
                            Text(tramo).font(.headline)
                        }
                    }
                }
                .multilineTextAlignment(.center)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(Color.black.opacity(0.65))
                .foregroundColor(.white)
                .cornerRadius(14)
                .padding(.horizontal, 12)
                Spacer()
                VStack(spacing: 10) {
                    Picker("Mostrar", selection: $controlador.soloLinea) {
                        Text("Flechas").tag(false)
                        Text("Línea").tag(true)
                    }
                    .pickerStyle(.segmented)
                    HStack(spacing: 10) {
                        Button("🔄 Buscar QR") { controlador.buscarQR() }
                            .buttonStyle(.bordered)
                        Button("✕ Cerrar") { cerrar() }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .padding(12)
                .background(.ultraThinMaterial)
                .cornerRadius(16)
                .padding(12)
            }
        }
    }
}
