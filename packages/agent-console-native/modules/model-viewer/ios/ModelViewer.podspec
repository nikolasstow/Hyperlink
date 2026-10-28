Pod::Spec.new do |s|
  s.name           = 'ModelViewer'
  s.version        = '1.0.0'
  s.summary        = 'A 3D view of a print model from the relay'
  s.description    = 'A 3D view of a print model from the relay'
  s.license        = { :type => 'MIT' }
  s.author         = 'Nikolas Stow'
  s.homepage       = 'https://github.com/nikolasstow/Hyperlink'
  s.platforms      = { :ios => '15.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/nikolasstow/Hyperlink.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'SceneKit'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
