Pod::Spec.new do |s|
  s.name           = 'DetentSlider'
  s.version        = '1.0.0'
  s.summary        = 'A native slider that snaps to given stops, with haptics'
  s.description    = 'A SwiftUI Slider that snaps to given stops, with the selection haptic on each'
  s.license        = { :type => 'MIT' }
  s.author         = 'Nikolas Stow'
  s.homepage       = 'https://github.com/nikolasstow/Hyperlink'
  s.platforms      = { :ios => '15.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/nikolasstow/Hyperlink.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
