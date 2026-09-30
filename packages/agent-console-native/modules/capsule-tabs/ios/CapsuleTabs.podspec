Pod::Spec.new do |s|
  s.name           = 'CapsuleTabs'
  s.version        = '1.0.0'
  s.summary        = 'A native strip of capsule tabs that animate between selections'
  s.description    = 'A SwiftUI row of glass capsule tabs; an icon tab collapses to its icon when not selected'
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
