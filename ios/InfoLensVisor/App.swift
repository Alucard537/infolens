import SwiftUI

@main
struct InfoLensApp: App {
    @StateObject private var aplicacion = AplicacionInfoLens()
    @Environment(\.scenePhase) private var faseEscena

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
                    if aplicacion.modeloEnEdicion != nil {
                        PanelColocacionModelo(aplicacion: aplicacion, controlador: controlador)
                    } else if let mapa = controlador.mapaTemporal {
                        PanelMapaTemporal(controlador: controlador, mapa: mapa, terminar: aplicacion.terminarCalibracion)
                    } else if controlador.subanclaParaCalibrar != nil {
                        PanelCalibracion(controlador: controlador, diagnostico: aplicacion.diagnosticoPrecision,
                                         terminar: aplicacion.terminarCalibracion)
                    } else {
                        NombreFlotantePrueba(controlador: controlador).ignoresSafeArea().allowsHitTesting(false)
                        PanelPrueba(controlador: controlador, cerrar: aplicacion.cerrar)
                    }
                }
            }
            .onAppear { aplicacion.cambiarFase(faseEscena) }
            .onChange(of: faseEscena) { aplicacion.cambiarFase($0) }
            .onDisappear { aplicacion.cambiarFase(.inactive) }
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

private struct PanelCalibracion: View {
    @ObservedObject var controlador: ControladorAR
    let diagnostico: Bool
    let terminar: (Bool) -> Void

    var body: some View {
        VStack {
            Text(controlador.estado)
                .font(.subheadline.weight(.semibold))
                .padding(10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            Spacer()
            VStack(alignment: .leading, spacing: 10) {
                Text(diagnostico ? "Medir precisión de ARKit"
                     : "Calibrar \(controlador.subanclaParaCalibrar?.subancla?.nombre ?? "subancla")").font(.headline)
                if controlador.comprobandoRetorno {
                    Text("Mantén la cámara abierta hasta medir otra vez el centro del QR principal.")
                } else if let medida = controlador.medicionSubancla {
                    let distancia = Double(medida.pos.reduce(0) { $0 + $1 * $1 }).squareRoot()
                    Text("Distancia entre los centros: \(distancia.formatted(.number.precision(.fractionLength(2)))) m.")
                    Button(diagnostico ? "Ver error" : "Guardar medición") { terminar(true) }.buttonStyle(.borderedProminent)
                    if diagnostico && !controlador.medicionSimultanea && medida.retorno == nil {
                        Button("Comprobar el retorno al QR principal") { controlador.iniciarComprobacionRetorno() }
                            .buttonStyle(.bordered)
                    }
                } else if controlador.medicionSimultanea {
                    Text("Busca una posición desde la que puedas ver los dos QR y mantén el iPhone quieto.")
                } else if let intermedia = controlador.intermediaParaMedir?.subancla {
                    Text("Enfoca primero el QR principal, después «\(intermedia.nombre)» y por último el QR de comprobación.")
                } else {
                    Text("Mantén el QR principal encuadrado hasta que quede fijado. Rodea la máquina despacio y mantén la subancla encuadrada para terminar la medición.")
                }
                HStack {
                    Button("Repetir") { controlador.buscarQR() }.buttonStyle(.bordered)
                    Spacer()
                    Button("Cancelar", role: .cancel) { terminar(false) }.buttonStyle(.bordered)
                }
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        }
        .padding(12)
    }
}

private struct PanelMapaTemporal: View {
    @ObservedObject var controlador: ControladorAR
    @ObservedObject var mapa: MapaTemporalAR
    let terminar: (Bool) -> Void

    var body: some View {
        VStack {
            Text(controlador.estado)
                .font(.subheadline.weight(.semibold))
                .padding(10)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            Spacer()
            VStack(alignment: .leading, spacing: 10) {
                Text("Mapa temporal del entorno").font(.headline)
                switch mapa.fase {
                case .buscandoQR:
                    Text("Enfoca el QR principal para fijar el origen del escaneo.")
                case .grabando:
                    Text("Rodea la máquina mostrando esquinas y superficies fijas. Al terminar, vuelve a la zona inicial.")
                    Text("\(mapa.cantidadFotos) fotos · \(mapa.cantidadPuntos) puntos LiDAR")
                        .font(.subheadline.monospacedDigit())
                    Button("Probar con este mapa") { controlador.guardarYProbarMapa() }
                        .buttonStyle(.borderedProminent).disabled(!mapa.puedeGuardar)
                case .guardando:
                    ProgressView("Preparando el mapa…")
                case .relocalizando:
                    Text("Busca la misma vista que en una foto del escaneo.")
                    if let imagen = mapa.fotoGuia {
                        HStack(alignment: .bottom) {
                            Image(uiImage: imagen).resizable().scaledToFit().frame(maxHeight: 132)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityLabel("Foto del entorno para recuperar el origen")
                            if mapa.cantidadFotos > 1 {
                                Button("Ver otra foto") { mapa.avanzarFoto() }.buttonStyle(.bordered)
                            }
                        }
                    }
                    Button("Reintentar con el mapa") { controlador.volverAProbarMapa() }.buttonStyle(.bordered)
                case .recorriendo:
                    Text("Haz el recorrido y pulsa medir al llegar al QR de comprobación.")
                    Button("Medir en el QR de comprobación") { mapa.comenzarMedicion() }.buttonStyle(.borderedProminent)
                case .midiendo:
                    if let medida = controlador.medicionSubancla {
                        let error = mapa.errorCm(de: medida.pos).formatted(.number.precision(.fractionLength(0...1)))
                        Text("Error de posición: \(error) cm").font(.headline)
                        Button("Otra vuelta con el mapa") { controlador.volverAProbarMapa() }.buttonStyle(.borderedProminent)
                        Button("Ver resultado y salir") { terminar(true) }.buttonStyle(.bordered)
                    } else {
                        Text("Mantén el QR de comprobación encuadrado hasta confirmar la medición.")
                    }
                }
                Button("Salir y borrar el mapa", role: .cancel) { terminar(false) }.buttonStyle(.bordered)
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        }
        .padding(12)
    }
}

private struct NombreFlotantePrueba: View {
    @ObservedObject var controlador: ControladorAR

    var body: some View {
        GeometryReader { g in
            if controlador.recorrido?.colocacion == nil,
               let punto = controlador.destinoEnPantalla, let nombre = controlador.recorrido?.info.nombre {
                let x = g.size.width * CGFloat(punto.x)
                let y = g.size.height * CGFloat(punto.y)
                let ancho = min(152, g.size.width * 0.43)
                let desplazamiento = 16 + ancho / 2
                Text(nombre)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .foregroundColor(.white)
                    .padding(8)
                    .frame(width: ancho)
                    .background(Color(red: 0.07, green: 0.13, blue: 0.17), in: RoundedRectangle(cornerRadius: 12))
                    .position(x: x < g.size.width / 2 ? x + desplazamiento : x - desplazamiento,
                              y: max(110, min(g.size.height - 185, y)))
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
                if let recorrido = controlador.recorrido, let colocacion = recorrido.colocacion {
                    Text("Colocar subancla · \(recorrido.info.nombre ?? "")").font(.headline)
                    if let cara = recorrido.info.referencia, let medidas = recorrido.info.descripcion {
                        Text("\(cara) · \(medidas)").font(.subheadline)
                    }
                    if controlador.destinoEnPantalla != nil {
                        Text("Pega el QR de \(colocacion.ladoCm.formatted()) cm en el recuadro. \(colocacion.montaje.instruccion)")
                            .font(.subheadline)
                    } else if controlador.desdeCaraOpuesta {
                        Text("Sitúate en la cara indicada de la máquina para ver el recuadro.").font(.subheadline)
                    } else if let rumbo = controlador.rumboGrados {
                        HStack {
                            Image(systemName: "arrow.up").rotationEffect(.degrees(rumbo))
                            Text("Gira la cámara hacia el punto")
                        }.font(.subheadline)
                    }
                } else {
                    if controlador.destinoEnPantalla == nil {
                        Text(controlador.recorrido?.info.nombre ?? "Prueba del recorrido").font(.headline)
                    }
                    if let referencia = controlador.recorrido?.info.referencia {
                        Text(referencia).font(.subheadline)
                    }
                    Picker("Mostrar", selection: $controlador.soloLinea) {
                        Text("Flechas").tag(false)
                        Text("Línea").tag(true)
                    }
                    .pickerStyle(.segmented)
                }
                if let tramo = controlador.tramoActual { Text(tramo).font(.subheadline) }
                HStack {
                    Button("Volver a detectar QR") { controlador.buscarQR() }.buttonStyle(.bordered)
                    Spacer()
                    Button(controlador.recorrido?.colocacion == nil ? "Cerrar" : "Volver a editar", action: cerrar)
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding(14)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        }
        .padding(12)
    }
}
