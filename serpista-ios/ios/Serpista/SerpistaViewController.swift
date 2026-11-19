import UIKit
import WebKit

final class SerpistaViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let azul = UIColor(red: 0.055, green: 0.13, blue: 0.26, alpha: 1)
    private let turquesa = UIColor(red: 0.26, green: 0.85, blue: 0.79, alpha: 1)
    private var web: WKWebView!
    private let barra = UIToolbar()
    private let progreso = UIProgressView(progressViewStyle: .bar)
    private let aviso = UIStackView()
    private let textoAviso = UILabel()
    private var atras: UIBarButtonItem!
    private var observaciones: [NSKeyValueObservation] = []
    private var descargas: [ObjectIdentifier: URL] = [:]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = azul

        let configuracion = WKWebViewConfiguration()
        configuracion.websiteDataStore = .default()
        configuracion.allowsInlineMediaPlayback = true
        configuracion.mediaTypesRequiringUserActionForPlayback = [.audio, .video]
        configuracion.applicationNameForUserAgent = "SerpistaIOS/1.0"
        web = WKWebView(frame: .zero, configuration: configuracion)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = azul
        web.scrollView.backgroundColor = azul
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)

        barra.translatesAutoresizingMaskIntoConstraints = false
        barra.barStyle = .black
        barra.isTranslucent = false
        barra.barTintColor = azul
        barra.tintColor = turquesa
        atras = UIBarButtonItem(image: UIImage(systemName: "chevron.left"), style: .plain, target: self, action: #selector(volver))
        atras.accessibilityLabel = "Volver"
        let inicio = UIBarButtonItem(title: "SERPISTA", style: .plain, target: self, action: #selector(irInicio))
        inicio.accessibilityLabel = "Ir al inicio de Serpista"
        let recargar = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(actualizar))
        recargar.accessibilityLabel = "Actualizar"
        barra.items = [atras, .flexibleSpace(), inicio, .flexibleSpace(), recargar]
        view.addSubview(barra)

        progreso.translatesAutoresizingMaskIntoConstraints = false
        progreso.progressTintColor = turquesa
        progreso.trackTintColor = azul
        view.addSubview(progreso)
        NSLayoutConstraint.activate([
            barra.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            barra.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            barra.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            barra.heightAnchor.constraint(equalToConstant: 40),
            progreso.topAnchor.constraint(equalTo: barra.bottomAnchor),
            progreso.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progreso.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: progreso.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        prepararAviso()
        observaciones = [
            web.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
                self?.progreso.setProgress(Float(web.estimatedProgress), animated: true)
            },
            web.observe(\.isLoading, options: [.new]) { [weak self] web, _ in
                self?.progreso.isHidden = !web.isLoading
            },
            web.observe(\.canGoBack, options: [.initial, .new]) { [weak self] web, _ in
                self?.atras.isEnabled = web.canGoBack
            }
        ]
        irInicio()
    }

    private func prepararAviso() {
        aviso.axis = .vertical
        aviso.spacing = 20
        aviso.alignment = .center
        aviso.backgroundColor = azul
        aviso.isLayoutMarginsRelativeArrangement = true
        aviso.layoutMargins = UIEdgeInsets(top: 26, left: 24, bottom: 26, right: 24)
        aviso.layer.cornerRadius = 16
        aviso.translatesAutoresizingMaskIntoConstraints = false
        aviso.isHidden = true
        let titulo = UILabel()
        titulo.text = "Conectar con Serpista"
        titulo.font = .preferredFont(forTextStyle: .title2)
        titulo.textColor = .white
        titulo.adjustsFontForContentSizeCategory = true
        textoAviso.numberOfLines = 0
        textoAviso.textAlignment = .center
        textoAviso.font = .preferredFont(forTextStyle: .body)
        textoAviso.adjustsFontForContentSizeCategory = true
        textoAviso.textColor = .white
        let boton = UIButton(type: .system)
        boton.setTitle("Reintentar", for: .normal)
        boton.tintColor = turquesa
        boton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        boton.addTarget(self, action: #selector(actualizar), for: .touchUpInside)
        aviso.addArrangedSubview(titulo)
        aviso.addArrangedSubview(textoAviso)
        aviso.addArrangedSubview(boton)
        view.addSubview(aviso)
        NSLayoutConstraint.activate([
            aviso.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            aviso.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            aviso.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            aviso.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 18),
            aviso.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -18)
        ])
    }

    @objc private func irInicio() {
        aviso.isHidden = true
        web.load(URLRequest(url: ConfiguracionSerpista.inicio, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 25))
    }

    @objc private func actualizar() {
        aviso.isHidden = true
        if web.url == nil { irInicio() } else { web.reloadFromOrigin() }
    }

    @objc private func volver() {
        aviso.isHidden = true
        if web.canGoBack { web.goBack() }
    }

    private func mostrarError(_ mensaje: String) {
        textoAviso.text = mensaje
        aviso.isHidden = false
        progreso.isHidden = true
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        aviso.isHidden = true
        progreso.progress = 0
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        aviso.isHidden = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        mostrarError("No se ha podido conectar. Comprueba Internet y la conexión Tailscale del iPhone con tu servidor, y vuelve a intentarlo.")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        mostrarError("La carga se ha interrumpido. Comprueba la conexión y pulsa Reintentar.")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        mostrarError("La vista de Serpista se ha cerrado. Pulsa Reintentar para continuar.")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let esquema = (url.scheme ?? "").lowercased()
        if ["tel", "mailto", "whatsapp"].contains(esquema) {
            // Solo se abre la app externa tras una acción explícita del usuario.
            if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }
        guard ["https", "http", "about", "blob", "data"].contains(esquema) else {
            decisionHandler(.cancel)
            return
        }
        if esquema == "http" { decisionHandler(.cancel); return }
        if navigationAction.shouldPerformDownload { decisionHandler(.download) }
        else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Los enlaces y PDF con target=_blank se abren dentro de la aplicación.
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let permitido = origin.protocol == ConfiguracionSerpista.inicio.scheme && origin.host == ConfiguracionSerpista.inicio.host
        decisionHandler(permitido ? .prompt : .deny)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alerta = UIAlertController(title: "Serpista", message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "Aceptar", style: .default) { _ in completionHandler() })
        present(alerta, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alerta = UIAlertController(title: "Serpista", message: message, preferredStyle: .alert)
        alerta.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(false) })
        alerta.addAction(UIAlertAction(title: "Aceptar", style: .default) { _ in completionHandler(true) })
        present(alerta, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alerta = UIAlertController(title: "Serpista", message: prompt, preferredStyle: .alert)
        alerta.addTextField { campo in campo.text = defaultText }
        alerta.addAction(UIAlertAction(title: "Cancelar", style: .cancel) { _ in completionHandler(nil) })
        alerta.addAction(UIAlertAction(title: "Aceptar", style: .default) { _ in
            completionHandler(alerta.textFields?.first?.text ?? "")
        })
        present(alerta, animated: true)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            let carpeta = FileManager.default.temporaryDirectory.appendingPathComponent("Serpista-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: carpeta, withIntermediateDirectories: true)
            let nombre = (suggestedFilename as NSString).lastPathComponent
            let archivo = carpeta.appendingPathComponent(nombre.isEmpty || [".", ".."].contains(nombre) ? "documento" : nombre)
            descargas[ObjectIdentifier(download)] = archivo
            completionHandler(archivo)
        } catch { completionHandler(nil) }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let archivo = descargas.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let compartir = UIActivityViewController(activityItems: [archivo], applicationActivities: nil)
        compartir.popoverPresentationController?.sourceView = view
        compartir.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        compartir.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: archivo.deletingLastPathComponent())
        }
        present(compartir, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let archivo = descargas.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: archivo.deletingLastPathComponent())
        }
        mostrarError("No se ha podido descargar el archivo. Revisa la conexión y vuelve a intentarlo.")
    }
}
