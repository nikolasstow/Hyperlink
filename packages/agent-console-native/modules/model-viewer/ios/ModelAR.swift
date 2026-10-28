import ARKit
import QuickLook
import SceneKit
import UIKit
import simd

/// The model in AR, through AR Quick Look: the owner puts it on a table or
/// the floor, moves and turns it, and sees it at its real size.
///
/// The model goes to a USDZ file first, in metres (the mesh is in mm), with
/// its base on the ground and its middle at the origin, in the model's
/// colour. A crop keeps only the triangles between the two heights, and the
/// faces show from both sides, so the inside shows as in the viewer. One
/// file is kept; a new one replaces it.
final class ModelAR: NSObject, QLPreviewControllerDataSource {
  enum Failure: Error, CustomStringConvertible {
    case notAModel
    case nothingInCrop
    case noScreen

    var description: String {
      switch self {
      case .notAModel: return "The model file is not a whole model"
      case .nothingInCrop: return "The crop leaves nothing to show"
      case .noScreen: return "There is no screen to show AR on"
      }
    }
  }

  /// The one presentation now on screen. Quick Look holds its data source weakly.
  private static var current: ModelAR?

  private let item: ARQuickLookPreviewItem

  private init(file: URL) {
    item = ARQuickLookPreviewItem(fileAt: file)
    item.allowsContentScaling = true
    super.init()
  }

  /// Writes the AR file off the main thread, then shows it over the app.
  static func present(
    uri: URL,
    color: UIColor,
    clipLowMm: Double?,
    clipHighMm: Double?,
    title: String,
    from viewController: @escaping () -> UIViewController?,
    done: @escaping (Error?) -> Void
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      let file: URL
      do {
        file = try write(uri: uri, color: color, clipLowMm: clipLowMm, clipHighMm: clipHighMm, title: title)
      } catch {
        DispatchQueue.main.async { done(error) }
        return
      }
      DispatchQueue.main.async {
        guard let presenter = viewController() else {
          done(Failure.noScreen)
          return
        }
        let ar = ModelAR(file: file)
        current = ar
        let preview = QLPreviewController()
        preview.dataSource = ar
        presenter.present(preview, animated: true)
        done(nil)
      }
    }
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item }

  private static func write(uri: URL, color: UIColor, clipLowMm: Double?, clipHighMm: Double?, title: String) throws -> URL {
    guard let data = try? Data(contentsOf: uri, options: .mappedIfSafe),
          var geometry = ModelViewerView.geometry(from: data) else { throw Failure.notAModel }
    let cropped = clipLowMm != nil || clipHighMm != nil
    if cropped {
      guard let kept = crop(geometry, low: Float(clipLowMm ?? -1_000_000), high: Float(clipHighMm ?? 1_000_000)) else { throw Failure.nothingInCrop }
      geometry = kept
    }

    let material = SCNMaterial()
    material.lightingModel = .physicallyBased
    material.diffuse.contents = color
    material.roughness.contents = 0.55
    material.metalness.contents = 0.0
    material.isDoubleSided = cropped
    geometry.materials = [material]

    // The model's Z is up from the plate; USD's up is Y. Then mm to m, base on the ground, middle at the origin.
    let (low, high) = geometry.boundingBox
    let model = SCNNode(geometry: geometry)
    model.position = SCNVector3(-(low.x + high.x) / 2, -(low.y + high.y) / 2, -low.z)
    let upright = SCNNode()
    upright.eulerAngles.x = -.pi / 2
    upright.addChildNode(model)
    let metres = SCNNode()
    metres.scale = SCNVector3(0.001, 0.001, 0.001)
    metres.addChildNode(upright)
    let scene = SCNScene()
    scene.rootNode.addChildNode(metres)

    let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("model-ar", isDirectory: true)
    try? FileManager.default.removeItem(at: folder)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    // Quick Look shows the file's name as its title.
    let name = title.components(separatedBy: CharacterSet(charactersIn: "/\\:")).joined(separator: " ")
    let file = folder.appendingPathComponent(name.isEmpty ? "Model" : name).appendingPathExtension("usdz")
    guard scene.write(to: file, options: nil, delegate: nil, progressHandler: nil) else { throw Failure.notAModel }
    return file
  }

  /// The model between `low` and `high` (heights above the plate, in mm), cut flat at both: whole triangles inside stay, and
  /// triangles across a height are clipped there. Only the vertices in use stay, so the box fits the cut. Nil when nothing is left.
  private static func crop(_ geometry: SCNGeometry, low: Float, high: Float) -> SCNGeometry? {
    guard let vertexSource = geometry.sources(for: .vertex).first,
          let normalSource = geometry.sources(for: .normal).first,
          let element = geometry.elements.first else { return nil }
    let read = { (source: SCNGeometrySource) -> [SIMD3<Float>] in
      source.data.withUnsafeBytes { raw in
        (0..<source.vectorCount).map { v in
          SIMD3<Float>(
            raw.loadUnaligned(fromByteOffset: v * 12, as: Float.self),
            raw.loadUnaligned(fromByteOffset: v * 12 + 4, as: Float.self),
            raw.loadUnaligned(fromByteOffset: v * 12 + 8, as: Float.self)
          )
        }
      }
    }
    let positions = read(vertexSource)
    let normals = read(normalSource)
    let triangles: [UInt32] = element.data.withUnsafeBytes { raw in
      (0..<(element.primitiveCount * 3)).map { raw.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self) }
    }

    var outPositions = [SIMD3<Float>]()
    var outNormals = [SIMD3<Float>]()
    var indices = [UInt32]()
    // Each whole-triangle vertex's new index, by its old one: those vertices stay shared.
    var newIndex = [UInt32: UInt32]()
    let add = { (position: SIMD3<Float>, normal: SIMD3<Float>) -> UInt32 in
      outPositions.append(position)
      outNormals.append(normal)
      return UInt32(outPositions.count - 1)
    }
    // Keeps the part of a polygon on one side of a height: `above` keeps z >= height, else z <= height.
    let clip = { (polygon: [(SIMD3<Float>, SIMD3<Float>)], height: Float, above: Bool) -> [(SIMD3<Float>, SIMD3<Float>)] in
      var kept = [(SIMD3<Float>, SIMD3<Float>)]()
      for k in 0..<polygon.count {
        let a = polygon[k]
        let b = polygon[(k + 1) % polygon.count]
        let aIn = above ? a.0.z >= height : a.0.z <= height
        let bIn = above ? b.0.z >= height : b.0.z <= height
        if aIn { kept.append(a) }
        if aIn != bIn {
          let t = (height - a.0.z) / (b.0.z - a.0.z)
          kept.append((a.0 + (b.0 - a.0) * t, simd_normalize(a.1 + (b.1 - a.1) * t)))
        }
      }
      return kept
    }
    for t in 0..<(triangles.count / 3) {
      let corners = [triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]]
      let zs = corners.map { positions[Int($0)].z }
      if zs.allSatisfy({ $0 < low }) || zs.allSatisfy({ $0 > high }) { continue }
      if zs.allSatisfy({ $0 >= low && $0 <= high }) {
        for corner in corners {
          if let known = newIndex[corner] {
            indices.append(known)
          } else {
            let next = add(positions[Int(corner)], normals[Int(corner)])
            newIndex[corner] = next
            indices.append(next)
          }
        }
        continue
      }
      let polygon = clip(clip(corners.map { (positions[Int($0)], normals[Int($0)]) }, low, true), high, false)
      guard polygon.count >= 3 else { continue }
      let fan = polygon.map { add($0.0, $0.1) }
      for k in 1..<(fan.count - 1) {
        indices.append(fan[0])
        indices.append(fan[k])
        indices.append(fan[k + 1])
      }
    }
    guard !indices.isEmpty else { return nil }

    let pack = { (vectors: [SIMD3<Float>]) -> Data in
      var floats = [Float](repeating: 0, count: vectors.count * 3)
      for (v, value) in vectors.enumerated() {
        floats[v * 3] = value.x
        floats[v * 3 + 1] = value.y
        floats[v * 3 + 2] = value.z
      }
      return floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }
    let stride = MemoryLayout<Float>.size * 3
    let count = outPositions.count
    return SCNGeometry(
      sources: [
        SCNGeometrySource(data: pack(outPositions), semantic: .vertex, vectorCount: count, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride),
        SCNGeometrySource(data: pack(outNormals), semantic: .normal, vectorCount: count, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride),
      ],
      elements: [SCNGeometryElement(data: indices.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: indices.count / 3, bytesPerIndex: 4)]
    )
  }
}
