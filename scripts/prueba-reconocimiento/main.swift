import AppKit
import WebKit

final class Prueba: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "infolens" { return }
        print("Reconocimiento: \(message.body)")
        let resultado = message.body as? [String: Any]
        exit(resultado?["ok"] as? Bool == true ? 0 : 1)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("\(error)\n", stderr)
        exit(1)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fputs("WebKit cerró el proceso de reconocimiento\n", stderr)
        exit(1)
    }
}

let app = NSApplication.shared
let prueba = Prueba()
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.userContentController.add(prueba, name: "infolens")
config.userContentController.add(prueba, name: "pruebaReconocimiento")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 450, height: 800), configuration: config)
web.navigationDelegate = prueba
let ventana = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
ventana.contentView = web
ventana.orderFront(nil)
let servidor = ServidorWeb(raiz: URL(fileURLWithPath: CommandLine.arguments[1]))
servidor.arrancar { resultado in
    switch resultado {
    case .success(let url):
        web.load(URLRequest(url: url.appendingPathComponent("prueba-reconocimiento.html")))
    case .failure(let error):
        fputs("\(error)\n", stderr)
        exit(1)
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
    fputs("Tiempo agotado esperando la prueba de WebKit\n", stderr)
    exit(1)
}
app.run()
