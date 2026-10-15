Pod::Spec.new do |s|
  s.name           = 'DubzHome'
  s.version        = '1.0.0'
  s.summary        = 'Dubz home suggestions surface, native'
  s.description    = 'A SwiftUI bottom-anchored scroll of glass session pills that scrolls behind the Dubz bars, with native expand and row animation'
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
