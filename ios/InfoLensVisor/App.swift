// InfoLens Visor: visor AR nativo (ARKit + LiDAR) para los recorridos de las guías de InfoLens.
// Se abre desde la app web con el botón "📱 Abrir en el visor nativo" (infolens://ruta?d=…).
import SwiftUI

@main
struct InfoLensVisorApp: App {
    @State private var controlador: ControladorAR?

    var body: some Scene {
        WindowGroup {
            Group {
                if let c = controlador {
                    PantallaAR(controlador: c) {
                        c.detener()
                        controlador = nil
                    }
                    .id(c.recorrido.clave)
                } else {
                    Bienvenida()
                }
            }
            .onOpenURL { url in
                guard let r = Recorrido.desdeURL(url) else { return }
                controlador?.detener()
                controlador = ControladorAR(recorrido: r)
            }
        }
    }
}

struct Bienvenida: View {
    var body: some View {
        VStack(spacing: 18) {
            Text("⚓ InfoLens Visor").font(.largeTitle.bold())
            Text("Abre un recorrido desde la app InfoLens: en el paso de la guía, toca «📱 Abrir en el visor nativo».")
                .multilineTextAlignment(.center)
            Text("Para probar: InfoLens → 🔬 Diagnóstico del AR → «📱 Prueba en el visor nativo».")
                .font(.footnote).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
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
                Text(controlador.estado)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(Color.black.opacity(0.65))
                    .foregroundColor(.white)
                    .cornerRadius(14)
                    .padding(.horizontal, 12)
                if !controlador.detectado {
                    Text("Apunta la cámara al QR del ancla impreso. El recorrido no aparece hasta que lo detecte.")
                        .font(.subheadline).foregroundColor(.white).padding(10)
                        .background(Color.black.opacity(0.5)).cornerRadius(12).padding(.horizontal, 12)
                }
                Spacer()
                VStack(spacing: 10) {
                    Picker("Mostrar", selection: $controlador.soloLinea) {
                        Text("Flechas").tag(false)
                        Text("Línea").tag(true)
                    }
                    .pickerStyle(.segmented)
                    HStack(spacing: 10) {
                        Button("↺ Girar 90°") { controlador.giro = (controlador.giro + 90) % 360 }
                            .buttonStyle(.bordered)
                        Button("🔄 Buscar QR") { controlador.arrancar() }
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
