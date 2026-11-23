import SwiftUI
import WebKit

@MainActor
final class AplicacionInfoLens: ObservableObject {
    @Published private(set) var controlador: ControladorAR?
    @Published private(set) var pruebaAbierta = false
    @Published var error: String?

    private var servidor: ServidorWeb?
    private weak var web: WKWebView?
    private var sesion: String?

    func cargar(en web: WKWebView) {
        self.web = web
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

    func cerrar() {
        controlador?.detener()
        controlador = nil
        sesion = nil
        pruebaAbierta = false
    }

    func abrirPrueba(_ recorrido: Recorrido) {
        cerrar()
        controlador = ControladorAR(recorrido: recorrido)
        pruebaAbierta = true
    }

    func recibir(_ mensaje: [String: Any]) {
        guard let accion = mensaje["accion"] as? String else { return }
        if accion == "prueba", let r = leerRecorrido(mensaje["recorrido"]) {
            abrirPrueba(r)
            return
        }
        guard let id = mensaje["sesion"] as? String, (1...80).contains(id.count) else { return }
        if accion == "iniciar" {
            guard let objetos = mensaje["anclas"], JSONSerialization.isValidJSONObject(objetos),
                  let datos = try? JSONSerialization.data(withJSONObject: objetos), datos.count < 350_000,
                  let anclas = try? JSONDecoder().decode([AnclaAR].self, from: datos),
                  (1...100).contains(anclas.count), anclas.allSatisfy(\.valida) else { return }
            let principales = Set(anclas.filter { $0.subancla == nil }.map(\.id))
            guard !principales.isEmpty, Set(anclas.map(\.id)).count == anclas.count,
                  anclas.allSatisfy({ principales.contains($0.principalId) }) else { return }
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
        case "recorrido":
            if let recorrido = leerRecorrido(mensaje["recorrido"]) {
                controlador?.cambiarRecorrido(recorrido, destinoId: mensaje["destinoId"] as? Int)
            }
        case "ocultar": controlador?.cambiarRecorrido(nil)
        case "vista": controlador?.soloLinea = mensaje["vista"] as? String == "linea"
        case "buscar": controlador?.buscarQR()
        case "cerrar": cerrar()
        default: break
        }
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
    }

    final class Coordinador: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        private let aplicacion: AplicacionInfoLens
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
