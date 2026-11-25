import SwiftUI
import WebKit
import Combine
import RealityKit

@MainActor
final class AplicacionInfoLens: ObservableObject {
    @Published private(set) var controlador: ControladorAR? {
        didSet {
            oldValue?.alCambiarCamara = nil
            controlador?.alCambiarCamara = { [weak self] in self?.actualizarBloqueoPantalla() }
            actualizarBloqueoPantalla()
        }
    }
    @Published private(set) var pruebaAbierta = false
    @Published private(set) var diagnosticoPrecision = false
    @Published var error: String?
    @Published private(set) var modeloEnEdicion: ModeloGuiaAR?
    @Published private(set) var modeloListo = false
    @Published private(set) var avisoModelo: String?

    private var servidor: ServidorWeb?
    private weak var web: WKWebView?
    private var observacionCamaraWeb: NSKeyValueObservation?
    private var escenaActiva = false
    private var sesion: String?
    private var solicitudCalibracion: String?
    private var solicitudModelo: String?
    private let archivosModelos = ArchivosModelosAR()
    private var descargaModelos: Task<Void, Never>?
    private var cargaModelos: [AnyCancellable] = []

    func cargar(en web: WKWebView) {
        self.web = web
        observacionCamaraWeb = web.observe(\.cameraCaptureState, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.actualizarBloqueoPantalla() }
        }
        actualizarBloqueoPantalla()
        guard servidor == nil else {
            web.load(URLRequest(url: ServidorWeb.inicio))
            return
        }
        guard let raiz = Bundle.main.url(forResource: "web-integrada", withExtension: nil) else {
            error = "La aplicación no contiene los archivos de InfoLens."
            return
        }
        let servidor = ServidorWeb(raiz: raiz)
        self.servidor = servidor
        servidor.arrancar { [weak self, weak web] resultado in
            switch resultado {
            case .success(let url): web?.load(URLRequest(url: url))
            case .failure(let error): self?.error = "No se pudo abrir InfoLens. \(error.localizedDescription)"
            }
        }
    }

    func cambiarFase(_ fase: ScenePhase) {
        escenaActiva = fase == .active
        actualizarBloqueoPantalla()
    }

    private func actualizarBloqueoPantalla() {
        let mantenerEncendida = escenaActiva && (controlador?.camaraActiva == true || web?.cameraCaptureState == .active)
        if UIApplication.shared.isIdleTimerDisabled != mantenerEncendida {
            UIApplication.shared.isIdleTimerDisabled = mantenerEncendida
        }
    }

    fileprivate func desmontarWeb(_ web: WKWebView) {
        guard self.web === web else { return }
        observacionCamaraWeb = nil
        self.web = nil
        cerrar()
    }

    func cerrar() {
        descargaModelos?.cancel()
        descargaModelos = nil
        cargaModelos.removeAll()
        controlador?.detener()
        controlador = nil
        sesion = nil
        solicitudCalibracion = nil
        diagnosticoPrecision = false
        solicitudModelo = nil
        modeloEnEdicion = nil
        modeloListo = false
        avisoModelo = nil
        pruebaAbierta = false
    }

    func abrirPrueba(_ recorrido: Recorrido) {
        cerrar()
        controlador = ControladorAR(recorrido: recorrido)
        pruebaAbierta = true
    }

    func terminarCalibracion(guardar: Bool) {
        guard let solicitud = solicitudCalibracion else { return }
        var medicion: Any = NSNull()
        if guardar {
            guard let medida = controlador?.medicionSubancla, let datos = try? JSONEncoder().encode(medida),
                  let objeto = try? JSONSerialization.jsonObject(with: datos) else { return }
            medicion = objeto
        }
        cerrar()
        enviarMedicion(solicitud, medicion: medicion)
    }

    private func enviarMedicion(_ solicitud: String, medicion: Any = NSNull(), error: String? = nil) {
        web?.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('infolens:calibracion', {detail: {solicitud, medicion, error}}));",
            arguments: ["solicitud": solicitud, "medicion": medicion, "error": error as Any? ?? NSNull()],
            in: nil, in: .page, completionHandler: nil
        )
    }

    func recibir(_ mensaje: [String: Any]) {
        guard let accion = mensaje["accion"] as? String else { return }
        if accion == "prueba", let r = leerRecorrido(mensaje["recorrido"]) {
            abrirPrueba(r)
            return
        }
        if accion == "calibrarSubancla" {
            guard let solicitud = mensaje["solicitud"] as? String, UUID(uuidString: solicitud) != nil else { return }
            guard let anclas = leerAnclas(mensaje["anclas"]), anclas.count == 2,
                  let subancla = anclas.first(where: { $0.subancla != nil }) else {
                enviarMedicion(solicitud, error: "No se pudieron preparar los dos QR. Revisa sus medidas y repite la prueba.")
                return
            }
            cerrar()
            solicitudCalibracion = solicitud
            diagnosticoPrecision = mensaje["diagnostico"] as? Bool == true
            controlador = ControladorAR(anclas: anclas, soloLinea: false, calibrar: subancla)
            pruebaAbierta = true
            return
        }
        if accion == "cancelarCalibracion" {
            if let solicitud = mensaje["solicitud"] as? String, solicitud == solicitudCalibracion { cerrar() }
            return
        }
        if accion == "colocarModelo" {
            guard let solicitud = mensaje["solicitud"] as? String, UUID(uuidString: solicitud) != nil else { return }
            guard let anclas = leerAnclas(mensaje["anclas"]), let modelo: ModeloGuiaAR = leerModeloMensaje(mensaje["modelo"]), modelo.valido,
                  anclas.contains(where: { $0.id == modelo.anclaId && $0.subancla == nil }) else {
                enviarColocacion(solicitud, pose: NSNull(), error: "El modelo o su ancla no son válidos.")
                return
            }
            cerrar()
            let ar = ControladorAR(anclas: anclas, soloLinea: false)
            controlador = ar
            solicitudModelo = solicitud
            modeloEnEdicion = modelo
            pruebaAbierta = true
            cargarModelos([modelo], en: ar)
            return
        }
        guard let id = mensaje["sesion"] as? String, (1...80).contains(id.count) else { return }
        if accion == "iniciar" {
            guard let anclas = leerAnclas(mensaje["anclas"]) else { return }
            cerrar()
            sesion = id
            let ar = ControladorAR(anclas: anclas, soloLinea: mensaje["vista"] as? String == "linea")
            controlador = ar
            ar.alCambiarEstado = { [weak self] estado in self?.enviar(estado, sesion: id) }
            ar.emitirEstado()
            return
        }
        guard id == sesion else { return }
        switch accion {
        case "modelosGuia":
            if let ar = controlador, let modelos: [ModeloGuiaAR] = leerModeloMensaje(mensaje["modelos"]), modelos.count <= 24 {
                cargarModelos(modelos.filter { $0.valido && ar.admiteModelo($0) }, en: ar)
            }
        case "recorrido":
            let destinoId = mensaje["destinoId"] as? Int
            if let recorrido = leerRecorrido(mensaje["recorrido"]) {
                controlador?.cambiarRecorrido(recorrido, destinoId: destinoId)
            } else {
                controlador?.cambiarRecorrido(nil, destinoId: destinoId, error: "La posición del elemento no es válida. Revisa los tramos o su localización.")
            }
        case "elementos":
            let destinoId = mensaje["destinoId"] as? Int
            if let objeto = mensaje["elementos"], JSONSerialization.isValidJSONObject(objeto),
               let datos = try? JSONSerialization.data(withJSONObject: objeto), let elementos = ElementosDeGuia.desdeDatos(datos) {
                controlador?.cambiarRecorrido(nil, elementos: elementos, destinoId: destinoId)
            } else {
                controlador?.cambiarRecorrido(nil, destinoId: destinoId, error: "No se pudieron cargar las posiciones de los elementos.")
            }
        case "ocultar": controlador?.cambiarRecorrido(nil)
        case "vista": controlador?.soloLinea = mensaje["vista"] as? String == "linea"
        case "linterna":
            if let encendida = mensaje["encendida"] as? Bool { controlador?.cambiarLinterna(encendida: encendida) }
        case "buscar": controlador?.buscarQR()
        case "cerrar": cerrar()
        default: break
        }
    }

    private func leerModeloMensaje<T: Decodable>(_ objeto: Any?) -> T? {
        guard let objeto, JSONSerialization.isValidJSONObject(objeto),
              let datos = try? JSONSerialization.data(withJSONObject: objeto), datos.count <= 24000 else { return nil }
        return try? JSONDecoder().decode(T.self, from: datos)
    }

    private func avisoCargaModelo(_ error: Error) {
        let mensaje = "No se pudo cargar el modelo 3D. Revisa el archivo en la biblioteca."
        if solicitudModelo != nil { avisoModelo = mensaje }
        else if let sesion {
            web?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('infolens:modelos-error', {detail: {sesion, mensaje}}));",
                arguments: ["sesion": sesion, "mensaje": mensaje], in: nil, in: .page, completionHandler: nil)
        }
    }

    private func cargarModelos(_ modelos: [ModeloGuiaAR], en ar: ControladorAR) {
        descargaModelos?.cancel()
        cargaModelos.removeAll()
        guard let web else { return }
        descargaModelos = Task { [weak self, weak ar] in
            for modelo in modelos {
                guard let self, let ar, self.controlador === ar, !Task.isCancelled else { return }
                do {
                    let url = try await self.archivosModelos.archivo(modelo.archivoId, web: web)
                    try Task.checkCancellation()
                    guard self.controlador === ar else { return }
                    let carga = Entity.loadAsync(contentsOf: url).receive(on: DispatchQueue.main).sink { [weak self, weak ar] fin in
                        guard case .failure(let error) = fin, let self, let ar, self.controlador === ar else { return }
                        self.avisoCargaModelo(error)
                    } receiveValue: { [weak self, weak ar] entidad in
                        guard let self, let ar, self.controlador === ar else { return }
                        ar.mostrarModelo(entidad, modelo: self.modeloEnEdicion ?? modelo)
                        if self.modeloEnEdicion != nil { self.modeloListo = true }
                    }
                    self.cargaModelos.append(carga)
                } catch is CancellationError { return }
                catch { if self.controlador === ar { self.avisoCargaModelo(error) } }
            }
        }
    }

    func ajustarModelo(_ modelo: ModeloGuiaAR) {
        guard modelo.id == modeloEnEdicion?.id, modelo.valido else { return }
        avisoModelo = nil
        modeloEnEdicion = modelo
        controlador?.ajustarModelo(modelo)
    }

    func marcarModelo() {
        guard var modelo = modeloEnEdicion, let punto = controlador?.puntoModeloEnLaMira() else {
            avisoModelo = "Apunta a una superficie visible y vuelve a marcar. También puedes ajustar la posición con Mover."
            return
        }
        modelo.pos = punto
        ajustarModelo(modelo)
    }

    func terminarModelo(guardar: Bool) {
        guard let solicitud = solicitudModelo else { return }
        let pose: Any
        if guardar {
            guard let m = modeloEnEdicion, modeloListo, controlador?.modeloPuedeColocarse == true else { return }
            pose = ["pos": m.pos, "rotacion": m.rotacion, "escala": m.escala]
        } else { pose = NSNull() }
        cerrar()
        enviarColocacion(solicitud, pose: pose)
    }

    private func enviarColocacion(_ solicitud: String, pose: Any, error: String? = nil) {
        web?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('infolens:modelo-colocado', {detail: {solicitud, pose, error}}));",
            arguments: ["solicitud": solicitud, "pose": pose, "error": error as Any? ?? NSNull()],
            in: nil, in: .page, completionHandler: nil)
    }

    private func leerAnclas(_ objeto: Any?) -> [AnclaAR]? {
        guard let objeto, JSONSerialization.isValidJSONObject(objeto),
              let datos = try? JSONSerialization.data(withJSONObject: objeto), datos.count < 350_000,
              let anclas = try? JSONDecoder().decode([AnclaAR].self, from: datos),
              (1...100).contains(anclas.count), anclas.allSatisfy(\.valida) else { return nil }
        let principales = Set(anclas.filter { $0.subancla == nil }.map(\.id))
        guard !principales.isEmpty, Set(anclas.map(\.id)).count == anclas.count,
              anclas.allSatisfy({ principales.contains($0.principalId) }) else { return nil }
        return anclas
    }

    private func leerRecorrido(_ objeto: Any?) -> Recorrido? {
        guard let objeto, JSONSerialization.isValidJSONObject(objeto),
              let datos = try? JSONSerialization.data(withJSONObject: objeto) else { return nil }
        return Recorrido.desdeDatos(datos)
    }

    private func enviar(_ estado: EstadoAR, sesion: String) {
        guard sesion == self.sesion, let datos = try? JSONEncoder().encode(estado),
              let objeto = try? JSONSerialization.jsonObject(with: datos) else { return }
        web?.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('infolens:arkit', {detail: {sesion, estado}}));",
            arguments: ["sesion": sesion, "estado": objeto], in: nil, in: .page, completionHandler: nil
        )
    }
}

struct WebInfoLens: UIViewRepresentable {
    let aplicacion: AplicacionInfoLens

    func makeCoordinator() -> Coordinador { Coordinador(aplicacion: aplicacion) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "infolens")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.underPageBackgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        aplicacion.cargar(en: web)
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinador) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "infolens")
        coordinator.aplicacion.desmontarWeb(uiView)
    }

    final class Coordinador: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        fileprivate let aplicacion: AplicacionInfoLens
        private var descargas: [ObjectIdentifier: URL] = [:]

        init(aplicacion: AplicacionInfoLens) { self.aplicacion = aplicacion }

        private func local(_ url: URL?) -> Bool {
            url?.scheme == "http" && url?.host == ServidorWeb.inicio.host && url?.port == ServidorWeb.inicio.port
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            let origen = message.frameInfo.securityOrigin
            guard message.name == "infolens", message.frameInfo.isMainFrame,
                  origen.protocol == "http", origen.host == ServidorWeb.inicio.host,
                  origen.port == ServidorWeb.inicio.port,
                  let cuerpo = message.body as? [String: Any] else { return }
            aplicacion.recibir(cuerpo)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if action.shouldPerformDownload && local(action.sourceFrame.request.url) {
                decisionHandler(.download)
            } else if local(url) || (action.targetFrame?.isMainFrame == false && url.scheme == "blob") {
                decisionHandler(.allow)
            } else if url.scheme == "infolens", local(action.sourceFrame.request.url),
                      let ruta = Recorrido.desdeURL(url) {
                aplicacion.abrirPrueba(ruta)
                decisionHandler(.cancel)
            } else {
                if action.navigationType == .linkActivated && url.scheme == "https" { UIApplication.shared.open(url) }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard let url = navigationAction.request.url, local(url) else { return nil }
            webView.load(navigationAction.request)
            return nil
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            aplicacion.cerrar()
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            aplicacion.cerrar()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            aplicacion.error = "No se pudo cargar InfoLens. \(error.localizedDescription)"
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alerta = UIAlertController(title: "InfoLens", message: message, preferredStyle: .alert)
            alerta.addAction(UIAlertAction(title: "Aceptar", style: .default) { _ in completionHandler() })
            if let vista = presentador(en: webView.window) { vista.present(alerta, animated: true) }
            else { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alerta = UIAlertController(title: "InfoLens", message: message, preferredStyle: .alert)
            alerta.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
            alerta.addAction(UIAlertAction(title: "Continuar", style: .default) { _ in completionHandler(true) })
            if let vista = presentador(en: webView.window) { vista.present(alerta, animated: true) }
            else { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            ventanaDescarga = webView.window
            download.delegate = self
        }

        private weak var ventanaDescarga: UIWindow?

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                      suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let carpeta = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: false)
                let nombre = (suggestedFilename as NSString).lastPathComponent
                let archivo = carpeta.appendingPathComponent(nombre.isEmpty || nombre == "." || nombre == ".." ? "InfoLens" : nombre)
                descargas[ObjectIdentifier(download)] = archivo
                completionHandler(archivo)
            } catch {
                completionHandler(nil)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let archivo = descargas.removeValue(forKey: ObjectIdentifier(download)),
                  let vista = presentador(en: ventanaDescarga) else { return }
            let compartir = UIActivityViewController(activityItems: [archivo], applicationActivities: nil)
            compartir.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: archivo.deletingLastPathComponent())
            }
            compartir.popoverPresentationController?.sourceView = vista.view
            vista.present(compartir, animated: true)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let archivo = descargas.removeValue(forKey: ObjectIdentifier(download)) {
                try? FileManager.default.removeItem(at: archivo.deletingLastPathComponent())
            }
            aplicacion.error = "No se pudo guardar el archivo. \(error.localizedDescription)"
        }

        private func presentador(en ventana: UIWindow?) -> UIViewController? {
            var vista = ventana?.rootViewController
            while let siguiente = vista?.presentedViewController { vista = siguiente }
            return vista
        }
    }
}
