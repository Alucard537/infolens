import Foundation
import Network

/// Sirve únicamente los recursos incluidos en la IPA, en un origen estable para IndexedDB.
final class ServidorWeb {
    static let inicio = URL(string: "http://127.0.0.1:41967/")!
    private let raiz: URL
    private let cola = DispatchQueue(label: "InfoLens.web")
    private var listener: NWListener?

    init(raiz: URL) {
        self.raiz = raiz.resolvingSymlinksInPath()
    }

    func arrancar(_ resultado: @escaping (Result<URL, Error>) -> Void) {
        let parametros = NWParameters.tcp
        parametros.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: 41967)
        do {
            let listener = try NWListener(using: parametros)
            listener.stateUpdateHandler = { [weak listener] estado in
                switch estado {
                case .ready:
                    DispatchQueue.main.async { resultado(.success(Self.inicio)) }
                case .failed(let error):
                    listener?.cancel()
                    DispatchQueue.main.async { resultado(.failure(error)) }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] conexion in
                guard let self else { conexion.cancel(); return }
                conexion.start(queue: self.cola)
                self.cola.asyncAfter(deadline: .now() + 20) { [weak conexion] in conexion?.cancel() }
                self.recibir(conexion, acumulado: Data())
            }
            self.listener = listener
            listener.start(queue: cola)
        } catch {
            resultado(.failure(error))
        }
    }

    deinit { listener?.cancel() }

    private func recibir(_ conexion: NWConnection, acumulado: Data) {
        conexion.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] bytes, _, fin, error in
            guard let self, error == nil else { conexion.cancel(); return }
            let datos = acumulado + (bytes ?? Data())
            guard datos.count <= 16_384 else {
                self.responder(conexion, estado: "431 Request Header Fields Too Large")
                return
            }
            if let cabecera = datos.range(of: Data("\r\n\r\n".utf8)),
               let texto = String(data: datos.prefix(upTo: cabecera.lowerBound), encoding: .utf8) {
                self.servir(texto, en: conexion)
            } else if fin {
                conexion.cancel()
            } else {
                self.recibir(conexion, acumulado: datos)
            }
        }
    }

    private func servir(_ cabecera: String, en conexion: NWConnection) {
        let lineas = cabecera.components(separatedBy: "\r\n")
        let peticion = lineas[0].split(separator: " ")
        guard peticion.count == 3, peticion[0] == "GET" || peticion[0] == "HEAD",
              peticion[1].hasPrefix("/"), !peticion[1].hasPrefix("//"),
              lineas.dropFirst().contains(where: { $0.lowercased() == "host: 127.0.0.1:41967" }) else {
            responder(conexion, estado: "400 Bad Request")
            return
        }
        let ruta = peticion[1].split(separator: "?", maxSplits: 1).first ?? "/"
        guard let decodificada = String(ruta).removingPercentEncoding,
              !decodificada.contains("\\"), !decodificada.contains("\u{0}"),
              !decodificada.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else {
            responder(conexion, estado: "400 Bad Request")
            return
        }
        let path = decodificada == "/" ? "index.html" : String(decodificada.dropFirst())
        let archivo = raiz.appendingPathComponent(path).resolvingSymlinksInPath()
        guard archivo.path.hasPrefix(raiz.path + "/"),
              (try? archivo.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
              let datos = try? Data(contentsOf: archivo, options: .mappedIfSafe) else {
            responder(conexion, estado: "404 Not Found")
            return
        }
        let tipo = Self.tipos[archivo.pathExtension.lowercased()] ?? "application/octet-stream"
        responder(conexion, estado: "200 OK", tipo: tipo, datos: datos, cabeceras: peticion[0] == "HEAD")
    }

    private func responder(_ conexion: NWConnection, estado: String, tipo: String = "text/plain",
                           datos: Data = Data(), cabeceras: Bool = false) {
        let respuesta = "HTTP/1.1 \(estado)\r\nContent-Type: \(tipo)\r\nContent-Length: \(datos.count)\r\n" +
            "Connection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        let enviarCuerpo = !cabeceras && !datos.isEmpty
        let terminar: NWConnection.SendCompletion = .contentProcessed { error in
            guard error == nil else { conexion.cancel(); return }
            // Espera a que el cliente cierre tras leer la respuesta y su FIN.
            conexion.receive(minimumIncompleteLength: 1, maximumLength: 1) { _, _, _, _ in conexion.cancel() }
        }
        conexion.batch {
            conexion.send(content: Data(respuesta.utf8), contentContext: .finalMessage, isComplete: !enviarCuerpo,
                          completion: enviarCuerpo ? .contentProcessed { error in
                              if error != nil { conexion.cancel() }
                          } : terminar)
            if enviarCuerpo {
                conexion.send(content: datos, contentContext: .finalMessage, isComplete: true, completion: terminar)
            }
        }
    }

    private static let tipos = [
        "html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
        "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "json": "application/json", "webmanifest": "application/manifest+json", "wasm": "application/wasm",
        "png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "webp": "image/webp",
        "svg": "image/svg+xml", "ico": "image/x-icon", "pdf": "application/pdf", "usdz": "model/vnd.usdz+zip",
        "woff": "font/woff", "woff2": "font/woff2", "ttf": "font/ttf",
    ]
}
