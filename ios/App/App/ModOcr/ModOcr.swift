import Capacitor
import PDFKit
import UIKit
import Vision

/// Text recognition for a chord sheet that is a picture: a photo of a songbook
/// page, a screenshot, or a PDF that is a scan or an image export (Ultimate
/// Guitar's is one — it has no text in it to copy).
///
/// **What it returns is boxes, not a transcript.** One `{t, x, y, w, h}` per
/// fragment Vision found, in the page's own coordinates (0–1, origin top-left).
/// A chord sheet is chords *above* lyrics with spaces between them, and Vision
/// hands back "G", "B" and "Cm" as separate fragments; deciding which of them
/// share a line, and how far apart to space them, is `ocrObservationsToText` in
/// index.html. It lives there, not here, because it is plain JavaScript that
/// `tests/chords/ocr.test.js` can run on a Mac with no phone, and the parser
/// that reads its output (`parseChordSheet`) is there too.
///
/// **No language correction.** Vision's correction turns "Bm7" into a word, and
/// "Cmaj7" into another one. Chords are not language, so it is off and the
/// parser's own tolerance for the usual misreads (`_sheetLenient`) does that
/// job on lines it already knows hold chords.
///
/// **A PDF is rendered here**, a page at a time, because Vision reads images
/// and `PDFPage` is the thing that knows how to draw one. A PDF that has real
/// text in it is read from that text instead (`PDFPage.string` does not need an
/// image at all); only a page with none is drawn and recognised. Pages are
/// capped, so a 300-page songbook does not hold the phone for a minute.
///
/// Runs off the main thread and resolves when the last page is done. Nothing
/// leaves the device: Vision's recognizer is on-device, there is no network
/// call and no account.
@objc(ModOcr)
public class ModOcr: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ModOcr"
    public let jsName = "ModOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    /// Same proof the other app-target plugins print: one that is not named in
    /// ModRiffViewController is simply absent, which the page reads as "this
    /// device cannot".
    override public func load() {
        NSLog("[ModOcr] plugin registered")
    }

    private static let maxPages = 8
    /// The long side a PDF page is drawn at. Vision wants the text a few dozen
    /// pixels tall; a letter page at this size puts a chord letter at about 40.
    private static let pdfLongSide: CGFloat = 2600

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("no image data")
            return
        }
        let isPDF = (call.getString("kind") ?? "image") == "pdf"
        DispatchQueue.global(qos: .userInitiated).async {
            var pages: [[String: Any]] = []
            if isPDF {
                guard let doc = PDFDocument(data: data), doc.pageCount > 0 else {
                    call.reject("not a readable PDF")
                    return
                }
                let n = min(doc.pageCount, ModOcr.maxPages)
                for i in 0..<n {
                    guard let page = doc.page(at: i) else { continue }
                    pages.append(self.readPDFPage(page))
                }
                var out: [String: Any] = ["pages": pages]
                if doc.pageCount > n { out["truncated"] = doc.pageCount }
                call.resolve(out)
            } else {
                guard let img = UIImage(data: data) else {
                    call.reject("not a readable image")
                    return
                }
                call.resolve(["pages": [self.readImage(img)]])
            }
        }
    }

    /// One PDF page. A page with a text layer is read from it; the fragments
    /// come out as selections, which carry their own bounds. A page with
    /// nothing (a scan) is drawn and recognised like a photo.
    private func readPDFPage(_ page: PDFPage) -> [String: Any] {
        let box = page.bounds(for: .mediaBox)
        if let text = page.string, text.trimmingCharacters(in: .whitespacesAndNewlines).count > 20,
           let obs = textLayerObservations(page, box: box), !obs.isEmpty {
            return ["obs": obs, "source": "text"]
        }
        let scale = ModOcr.pdfLongSide / max(box.width, box.height)
        let size = CGSize(width: box.width * scale, height: box.height * scale)
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            UIColor.white.set()
            ctx.fill(CGRect(origin: .zero, size: size))
            ctx.cgContext.translateBy(x: 0, y: size.height)
            ctx.cgContext.scaleBy(x: scale, y: -scale)
            page.draw(with: .mediaBox, to: ctx.cgContext)
        }
        var out = readImage(img)
        out["source"] = "image"
        return out
    }

    /// A PDF's own text, one fragment per line with its box. `PDFPage` can hand
    /// back a selection for each line; their bounds are in page space (origin
    /// bottom-left), turned here into the same top-left 0–1 the recogniser's
    /// boxes use so the page-side code does not care where they came from.
    private func textLayerObservations(_ page: PDFPage, box: CGRect) -> [[String: Any]]? {
        guard let whole = page.selection(for: box) else { return nil }
        var out: [[String: Any]] = []
        for line in whole.selectionsByLine() {
            guard let t = line.string?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { continue }
            let r = line.bounds(for: page)
            if r.isEmpty || box.width <= 0 || box.height <= 0 { continue }
            out.append(["t": t,
                        "x": Double((r.minX - box.minX) / box.width),
                        "y": Double(1 - (r.maxY - box.minY) / box.height),
                        "w": Double(r.width / box.width),
                        "h": Double(r.height / box.height)])
        }
        return out
    }

    private func readImage(_ image: UIImage) -> [String: Any] {
        // Redrawn upright: a photo from the camera carries its orientation as
        // metadata, and Vision's boxes are only meaningful against pixels that
        // are the right way up.
        let up: UIImage
        if image.imageOrientation == .up {
            up = image
        } else {
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1
            up = UIGraphicsImageRenderer(size: image.size, format: fmt).image { _ in
                image.draw(in: CGRect(origin: .zero, size: image.size))
            }
        }
        guard let cg = up.cgImage else { return ["obs": []] }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        req.recognitionLanguages = ["en-US"]
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        do { try handler.perform([req]) } catch {
            // The accurate recogniser runs on the neural engine, and a device
            // where that cannot start (found on a Mac with the engine not
            // reachable: the request throws and returns nothing) still has the
            // fast one. It reads less, but "less" is better than a blank box.
            req.recognitionLevel = .fast
            do { try handler.perform([req]) } catch {
                return ["obs": [], "error": String(describing: error)]
            }
        }
        var obs: [[String: Any]] = []
        for o in req.results ?? [] {
            guard let top = o.topCandidates(1).first else { continue }
            let b = o.boundingBox            // 0–1, origin bottom-left
            obs.append(["t": top.string,
                        "x": Double(b.minX),
                        "y": Double(1 - b.maxY),
                        "w": Double(b.width),
                        "h": Double(b.height),
                        "c": Double(top.confidence)])
        }
        return ["obs": obs]
    }
}
