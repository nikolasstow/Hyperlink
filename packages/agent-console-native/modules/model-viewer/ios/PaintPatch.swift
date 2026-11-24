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

  /// A path point is on a face when the face's centre is this close (mm): the stroke's own faces.
  static let seedReach: Float = 0.35
  /// A face is on the stroke's side when its normal is within about 84° of the face under the stroke.
  static let facingMin: Float = 0.1

  /// The faces each path paints, as the relay works them out (saturn-uploader PlanData.paintRegion):
  /// the faces under the path's points, then the faces joined to them edge to edge whose centre is within
  /// `radius` of the path and which face the same side. A thin wall's far side, or a part not joined to the
  /// stroke, is never painted, and two paths never join. The faces are lifted off the surface and drawn as a sheet.
  static func geometry(mesh: TriangleMesh, paths: [[SIMD3<Float>]], radius: Float) -> SCNGeometry? {
    guard radius > 0, !paths.isEmpty else { return nil }
    let p = mesh.positions
    let idx = mesh.indices
    let faceCount = idx.count / 3
    func corner(_ t: Int, _ c: Int) -> SIMD3<Float> { p[Int(idx[t * 3 + c])] }
    func centre(_ t: Int) -> SIMD3<Float> { (corner(t, 0) + corner(t, 1) + corner(t, 2)) / 3 }
    func normal(_ t: Int) -> SIMD3<Float>? {
      let n = simd_cross(corner(t, 1) - corner(t, 0), corner(t, 2) - corner(t, 0))
      let length = simd_length(n)
      return length > 0 ? n / length : nil
    }
    let reach = radius + seedReach
    var low = SIMD3<Float>(repeating: .infinity), high = SIMD3<Float>(repeating: -.infinity)
    for path in paths { for point in path { low = simd_min(low, point - reach); high = simd_max(high, point + reach) } }
    var near: [Int] = []
    for t in 0..<faceCount {
      let c = centre(t)
      if c.x >= low.x && c.x <= high.x && c.y >= low.y && c.y <= high.y && c.z >= low.z && c.z <= high.z { near.append(t) }
    }
    // Faces joined edge to edge: near faces that share two corners.
    var byEdge: [UInt64: [Int]] = [:]
    func edgeKey(_ a: UInt32, _ b: UInt32) -> UInt64 { UInt64(min(a, b)) << 32 | UInt64(max(a, b)) }
    for t in near { for c in 0..<3 { byEdge[edgeKey(idx[t * 3 + c], idx[t * 3 + (c + 1) % 3]), default: []].append(t) } }

    var painted = Set<Int>()
    let reach2 = radius * radius
    for path in paths where !path.isEmpty {
      let segments: [(SIMD3<Float>, SIMD3<Float>)] = path.count == 1 ? [(path[0], path[0])] : (0..<(path.count - 1)).map { (path[$0], path[$0 + 1]) }
      func nearest(_ q: SIMD3<Float>) -> (d2: Float, at: Int) {
        var best = Float.infinity, at = 0
        for (index, (a, b)) in segments.enumerated() {
          let d = b - a
          let length2 = simd_length_squared(d)
          let t = length2 == 0 ? 0 : max(0, min(1, simd_dot(q - a, d) / length2))
          let d2 = simd_length_squared(a + t * d - q)
          if d2 < best { best = d2; at = index }
        }
        return (best, at)
      }
      let seeds: [Int?] = path.map { point in
        var best: Int?, bestD = seedReach * seedReach
        for t in near {
          let d = simd_length_squared(centre(t) - point)
          if d < bestD { bestD = d; best = t }
        }
        return best
      }
      let seedNormals = seeds.map { $0.flatMap(normal) }
      func side(_ segment: Int) -> SIMD3<Float>? {
        (segment < seedNormals.count ? seedNormals[segment] : nil) ?? (segment + 1 < seedNormals.count ? seedNormals[segment + 1] : nil) ?? seedNormals.compactMap { $0 }.first
      }
      var region = Set(seeds.compactMap { $0 })
      var queue = Array(region)
      while let t = queue.popLast() {
        for c in 0..<3 {
          for next in byEdge[edgeKey(idx[t * 3 + c], idx[t * 3 + (c + 1) % 3])] ?? [] where !region.contains(next) {
            let (d2, at) = nearest(centre(next))
            guard d2 <= reach2, let facing = side(at), let n = normal(next), simd_dot(n, facing) >= facingMin else { continue }
            region.insert(next)
            queue.append(next)
          }
        }
      }
      painted.formUnion(region)
    }

    var vertices: [Float] = []
    var normals: [Float] = []
    for t in painted {
      guard let n = normal(t) else { continue }
      for c in 0..<3 {
        let lifted = corner(t, c) + n * lift
        vertices.append(contentsOf: [lifted.x, lifted.y, lifted.z])
        normals.append(contentsOf: [n.x, n.y, n.z])
      }
    }
    guard !vertices.isEmpty else { return nil }
    let vertexCount = vertices.count / 3
    let byteStride = MemoryLayout<Float>.size * 3
    let vertexSource = SCNGeometrySource(data: vertices.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .vertex, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: byteStride)
    let normalSource = SCNGeometrySource(data: normals.withUnsafeBufferPointer { Data(buffer: $0) }, semantic: .normal, vectorCount: vertexCount, usesFloatComponents: true, componentsPerVector: 3, bytesPerComponent: 4, dataOffset: 0, dataStride: byteStride)
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
