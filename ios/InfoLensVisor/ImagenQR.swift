// Imagen de referencia del QR del ancla para que ARKit lo detecte y lo SIGA (si se mueve o se gira).
// Se dibuja con los mismos módulos que el QR impreso (los manda la web), solo la zona negra, y con su
// medida real: así ARKit sabe dónde está el centro, el frente (borde de arriba) y la derecha.
import ARKit
import CoreImage
import UIKit

enum ImagenQR {
    static func referencia(para r: Recorrido) -> ARReferenceImage? {
        guard let imagen = dibujar(r) else { return nil }
        let ref = ARReferenceImage(imagen, orientation: .up, physicalWidth: CGFloat(r.ladoCm / 100))
        ref.name = r.anclaId
        return ref
    }

    private static func dibujar(_ r: Recorrido) -> CGImage? {
        if let m = r.modulos { return desdeModulos(m) }
        // Sin módulos: el QR se genera aquí (puede no ser idéntico al impreso)
        guard let filtro = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filtro.setValue(Data(r.textoQR.utf8), forKey: "inputMessage")
        filtro.setValue("M", forKey: "inputCorrectionLevel")
        guard let salida = filtro.outputImage else { return nil }
        // CoreImage añade 1 módulo de margen: se recorta
        let n = salida.extent.width
        let recorte = salida.cropped(to: CGRect(x: 1, y: 1, width: n - 2, height: n - 2))
        let escala = 600 / (n - 2)
        let grande = recorte.transformed(by: CGAffineTransform(scaleX: escala, y: escala))
        return CIContext().createCGImage(grande, from: grande.extent)
    }

    private static func desdeModulos(_ m: [[Bool]]) -> CGImage? {
        let n = m.count, px = 20, lado = n * px
        guard let ctx = CGContext(data: nil, width: lado, height: lado, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        ctx.setFillColor(gray: 1, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: lado, height: lado))
        ctx.setFillColor(gray: 0, alpha: 1)
        for f in 0..<n {
            for c in 0..<n where m[f][c] {
                // En CoreGraphics el origen está abajo: la fila 0 (arriba del QR) va al final
                ctx.fill(CGRect(x: c * px, y: (n - 1 - f) * px, width: px, height: px))
            }
        }
        return ctx.makeImage()
    }
}
