import ExpoModulesCore
import SceneKit
import simd

/// A surface's triangles as they are in the file, in the model's frame (mm): what a brush paints on.
struct TriangleMesh {
  let positions: [SIMD3<Float>]
  let indices: [UInt32]
}

/// A painted region to draw: the stroke paths (each flat x y z in mm), the brush radius, the colour,
/// and the surface it lies on ("model", "highlight" for the selected support, or "supports").
struct PaintPatchRecord: Record {
  @Field var key: String = ""
  @Field var color: String = "#ff3b30"
  @Field var radius: Double = 1
  @Field var surface: String = "model"
  @Field var paths: [[Double]] = []
}

enum PaintPatch {
  /// How far the patch sits off the surface along each triangle's normal (mm), so it draws over the surface.
  static let lift: Float = 0.02

  /// Every triangle of `mesh` with its centre or a corner within `radius` of a path (the polyline
  /// through its points), lifted off the surface: the same region the relay measures, drawn as a sheet.
  static func geometry(mesh: TriangleMesh, paths: [[SIMD3<Float>]], radius: Float) -> SCNGeometry? {
    var segments: [(SIMD3<Float>, SIMD3<Float>)] = []
    for path in paths {
      if path.count == 1, let only = path.first { segments.append((only, only)) }
      for n in 0..<max(0, path.count - 1) { segments.append((path[n], path[n + 1])) }
    }
    guard !segments.isEmpty, radius > 0 else { return nil }
    // The segments in a hash of cells as large as the reach: a point asks only its own cell.
    let cell = max(Float(0.5), radius)
    func key(_ p: SIMD3<Float>) -> SIMD3<Int32> { SIMD3<Int32>(Int32((p.x / cell).rounded(.down)), Int32((p.y / cell).rounded(.down)), Int32((p.z / cell).rounded(.down))) }
    var cells: [SIMD3<Int32>: [Int]] = [:]
    var reachLow = SIMD3<Float>(repeating: .infinity)
    var reachHigh = SIMD3<Float>(repeating: -.infinity)
    for (index, (a, b)) in segments.enumerated() {
      let low = simd_min(a, b) - radius
      let high = simd_max(a, b) + radius
      reachLow = simd_min(reachLow, low)
      reachHigh = simd_max(reachHigh, high)
      let k0 = key(low), k1 = key(high)
      for i in k0.x...k1.x { for j in k0.y...k1.y { for k in k0.z...k1.z { cells[SIMD3(i, j, k), default: []].append(index) } } }
    }
    let reach2 = radius * radius
    func within(_ p: SIMD3<Float>) -> Bool {
      guard let list = cells[key(p)] else { return false }
      for index in list {
        let (a, b) = segments[index]
        let d = b - a
        let length2 = simd_length_squared(d)
        let t = length2 == 0 ? 0 : max(0, min(1, simd_dot(p - a, d) / length2))
        if simd_length_squared(a + t * d - p) <= reach2 { return true }
      }
      return false
    }

    var vertices: [Float] = []
    var normals: [Float] = []
    let p = mesh.positions
    let count = mesh.indices.count / 3
    for t in 0..<count {
      let a = p[Int(mesh.indices[t * 3])], b = p[Int(mesh.indices[t * 3 + 1])], c = p[Int(mesh.indices[t * 3 + 2])]
      let low = simd_min(a, simd_min(b, c)), high = simd_max(a, simd_max(b, c))
      if high.x < reachLow.x || low.x > reachHigh.x || high.y < reachLow.y || low.y > reachHigh.y || high.z < reachLow.z || low.z > reachHigh.z { continue }
      guard within((a + b + c) / 3) || within(a) || within(b) || within(c) else { continue }
      let cross = simd_cross(b - a, c - a)
      let length = simd_length(cross)
      guard length > 0 else { continue }
      let normal = cross / length
      for corner in [a, b, c] {
        let lifted = corner + normal * lift
        vertices.append(contentsOf: [lifted.x, lifted.y, lifted.z])
        normals.append(contentsOf: [normal.x, normal.y, normal.z])
      }
    }
    guard !vertices.isEmpty else { return nil }
    let vertexCount = vertices.count / 3
    let stride = MemoryLayout<Float>.size * 3
    let vertexSource = SCNGeometrySource(data: vertices.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .vertex, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let normalSource = SCNGeometrySource(data: normals.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .normal, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: stride)
    let indices = (0..<UInt32(vertexCount)).map { $0 }
    let element = SCNGeometryElement(data: indices.withUnsafeBufferPointer { Data(buffer: $0) }, primitiveType: .triangles, primitiveCount: vertexCount / 3, bytesPerIndex: 4)
    return SCNGeometry(sources: [vertexSource, normalSource], elements: [element])
  }

  /// A record's paths as points.
  static func paths(of record: PaintPatchRecord) -> [[SIMD3<Float>]] {
    record.paths.map { flat in
      stride(from: 0, to: flat.count - 2, by: 3).map { SIMD3<Float>(Float(flat[$0]), Float(flat[$0 + 1]), Float(flat[$0 + 2])) }
    }.filter { !$0.isEmpty }
  }
}
