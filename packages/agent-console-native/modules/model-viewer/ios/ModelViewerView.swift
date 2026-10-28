import ExpoModulesCore
import SceneKit
import UIKit
import simd

/// A print's 3D model from the relay (`model.mesh`, saturn-uploader
/// `src/LayerMesh.ts`), in SceneKit. One finger turns the model about the
/// vertical axis and tilts it, two fingers move it, and a pinch zooms.
///
/// The file: `SLMS`, the version (1), the vertex and triangle counts, the
/// bounds' low and high corners in mm, the layer height and count, then each
/// vertex as three u16 across the bounds, padding to 4 bytes, and each
/// triangle as three u32 indices, counter-clockwise from outside. All
/// little-endian. The model's Z is up from the build plate; SceneKit's up is
/// Y, so the model node turns a quarter turn about X.
///
/// A new file with the same bounds (a finer level of the same model) takes
/// the old one's place and keeps the view. A crop (`clipLowMm`,
/// `clipHighMm`, heights above the plate) hides the model outside the range,
/// so the inside shows: its inner walls are drawn darker.
final class ModelViewerView: ExpoView {
  var uri: URL? { didSet { if uri != oldValue { load() } } }
  var modelColor: UIColor = UIColor(white: 0.85, alpha: 1) { didSet { material.diffuse.contents = modelColor } }
  var clipLowMm: Double? { didSet { if clipLowMm != oldValue { applyClip() } } }
  var clipHighMm: Double? { didSet { if clipHighMm != oldValue { applyClip() } } }

  /// Discards every fragment outside the crop, by its height in the model's own space, and darkens the back faces it shows.
  private static let clipShader = """
  #pragma arguments
  float clipLow;
  float clipHigh;
  #pragma body
  float4 local = scn_node.inverseModelViewTransform * float4(_surface.position, 1.0);
  if (local.z < clipLow || local.z > clipHigh) {
    discard_fragment();
  }
  if (dot(_surface.normal, _surface.view) < 0.0) {
    _output.color.rgb *= 0.5;
  }
  """

  private let scnView = SCNView()
  private let scene = SCNScene()
  private let material = SCNMaterial()
  private let cameraNode = SCNNode()
  private var modelNode: SCNNode?
  /// Each load has a number, so a slow parse of an old file never replaces a newer one.
  private var generation = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    material.diffuse.contents = modelColor
    material.lightingModel = .blinn
    material.specular.contents = UIColor(white: 0.25, alpha: 1)
    material.shininess = 0.35

    let camera = SCNCamera()
    camera.fieldOfView = 40
    cameraNode.camera = camera
    scene.rootNode.addChildNode(cameraNode)
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light?.type = .ambient
    ambient.light?.color = UIColor(white: 0.35, alpha: 1)
    scene.rootNode.addChildNode(ambient)

    scnView.scene = scene
    scnView.backgroundColor = .clear
    scnView.antialiasingMode = .multisampling4X
    // A light at the camera: the side the owner looks at is always lit.
    scnView.autoenablesDefaultLighting = true
    scnView.allowsCameraControl = true
    scnView.defaultCameraController.interactionMode = .orbitTurntable
    scnView.defaultCameraController.inertiaEnabled = true
    scnView.pointOfView = cameraNode
    addSubview(scnView)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    scnView.frame = bounds
  }

  private func load() {
    generation += 1
    let current = generation
    guard let uri else {
      modelNode?.removeFromParentNode()
      modelNode = nil
      return
    }
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let geometry = (try? Data(contentsOf: uri, options: .mappedIfSafe)).flatMap(ModelViewerView.geometry(from:))
      DispatchQueue.main.async {
        guard let self, current == self.generation, let geometry else { return }
        self.show(geometry)
      }
    }
  }

  private func applyClip() {
    guard clipLowMm != nil || clipHighMm != nil else {
      material.shaderModifiers = nil
      material.isDoubleSided = false
      return
    }
    material.shaderModifiers = [.fragment: ModelViewerView.clipShader]
    material.isDoubleSided = true
    material.setValue(Float(clipLowMm ?? -1_000_000), forKey: "clipLow")
    material.setValue(Float(clipHighMm ?? 1_000_000), forKey: "clipHigh")
  }

  private func show(_ geometry: SCNGeometry) {
    geometry.materials = [material]
    let previous = modelNode?.geometry?.boundingBox
    modelNode?.removeFromParentNode()
    let node = SCNNode(geometry: geometry)
    node.eulerAngles.x = -.pi / 2
    scene.rootNode.addChildNode(node)
    modelNode = node

    // A finer level of the same model has the same bounds: keep the owner's view.
    let (low, high) = geometry.boundingBox
    if let previous, ModelViewerView.near(previous.min, low), ModelViewerView.near(previous.max, high) { return }

    // Frame the whole model: its bounding sphere fills the view, seen from the front and a little above.
    let (center, radius) = node.boundingSphere
    let middle = node.convertPosition(center, to: scene.rootNode)
    let distance = Float(radius) / tan(Float(20.0 * Double.pi / 180)) * 1.1
    let tilt: Float = 0.45
    cameraNode.camera?.zNear = Double(max(0.1, distance - radius * 2))
    cameraNode.camera?.zFar = Double(distance + radius * 2)
    cameraNode.position = SCNVector3(middle.x, middle.y + distance * sin(tilt), middle.z + distance * cos(tilt))
    cameraNode.look(at: middle)
    scnView.pointOfView = cameraNode
    scnView.defaultCameraController.target = middle
  }

  private static func near(_ a: SCNVector3, _ b: SCNVector3) -> Bool {
    abs(a.x - b.x) < 1 && abs(a.y - b.y) < 1 && abs(a.z - b.z) < 1
  }

  /// The model as SceneKit geometry, with a normal per vertex from the triangles around it. Nil when the data is not a model.
  static func geometry(from data: Data) -> SCNGeometry? {
    let fixed = 48
    guard data.count >= fixed, data.prefix(4) == Data("SLMS".utf8) else { return nil }
    func u32(_ at: Int) -> UInt32 { data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: UInt32.self).littleEndian } }
    func f32(_ at: Int) -> Float { Float(bitPattern: u32(at)) }
    guard u32(4) == 1 else { return nil }
    let vertexCount = Int(u32(8))
    let triangleCount = Int(u32(12))
    let low = SIMD3<Float>(f32(16), f32(20), f32(24))
    let span = SIMD3<Float>(f32(28), f32(32), f32(36)) - low
    let positionBytes = vertexCount * 6
    let indexStart = fixed + positionBytes + (4 - positionBytes % 4) % 4
    guard vertexCount > 0, triangleCount > 0, data.count == indexStart + triangleCount * 12 else { return nil }

    var positions = [SIMD3<Float>](repeating: .zero, count: vertexCount)
    var indices = [UInt32](repeating: 0, count: triangleCount * 3)
    data.withUnsafeBytes { raw in
      for v in 0..<vertexCount {
        let at = fixed + v * 6
        let q = SIMD3<Float>(
          Float(raw.loadUnaligned(fromByteOffset: at, as: UInt16.self).littleEndian),
          Float(raw.loadUnaligned(fromByteOffset: at + 2, as: UInt16.self).littleEndian),
          Float(raw.loadUnaligned(fromByteOffset: at + 4, as: UInt16.self).littleEndian)
        )
        positions[v] = low + q / 65535 * span
      }
      for i in 0..<(triangleCount * 3) {
        indices[i] = raw.loadUnaligned(fromByteOffset: indexStart + i * 4, as: UInt32.self).littleEndian
      }
    }
    guard indices.allSatisfy({ Int($0) < vertexCount }) else { return nil }

    // Each vertex's normal: the sum of its triangles' normals, which weights each by its area.
    var normals = [SIMD3<Float>](repeating: .zero, count: vertexCount)
    for t in 0..<triangleCount {
      let a = Int(indices[t * 3]), b = Int(indices[t * 3 + 1]), c = Int(indices[t * 3 + 2])
      let n = simd_cross(positions[b] - positions[a], positions[c] - positions[a])
      normals[a] += n
      normals[b] += n
      normals[c] += n
    }
    for v in 0..<vertexCount {
      let length = simd_length(normals[v])
      normals[v] = length > 0 ? normals[v] / length : SIMD3<Float>(0, 0, 1)
    }

    let stride = MemoryLayout<Float>.size * 3
    // SIMD3 holds 4 floats; SceneKit takes 3 per vertex, packed.
    let packed = { (vectors: [SIMD3<Float>]) -> Data in
      var floats = [Float](repeating: 0, count: vectors.count * 3)
      for (v, value) in vectors.enumerated() {
        floats[v * 3] = value.x
        floats[v * 3 + 1] = value.y
        floats[v * 3 + 2] = value.z
      }
      return floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }
    let positionData = packed(positions)
    let normalData = packed(normals)
    let vertexSource = SCNGeometrySource(data: positionData, semantic: .vertex, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let normalSource = SCNGeometrySource(data: normalData, semantic: .normal, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let element = SCNGeometryElement(data: indices.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: triangleCount, bytesPerIndex: 4)
    return SCNGeometry(sources: [vertexSource, normalSource], elements: [element])
  }

  /// A colour from `#rrggbb` or `#rrggbbaa`; light grey for anything else.
  static func color(hex: String) -> UIColor {
    var text = hex.trimmingCharacters(in: .whitespaces)
    if text.hasPrefix("#") { text.removeFirst() }
    guard text.count == 6 || text.count == 8, let value = UInt64(text, radix: 16) else { return UIColor(white: 0.85, alpha: 1) }
    let rgba = text.count == 6 ? (value << 8) | 0xff : value
    return UIColor(
      red: CGFloat((rgba >> 24) & 0xff) / 255,
      green: CGFloat((rgba >> 16) & 0xff) / 255,
      blue: CGFloat((rgba >> 8) & 0xff) / 255,
      alpha: CGFloat(rgba & 0xff) / 255
    )
  }
}
