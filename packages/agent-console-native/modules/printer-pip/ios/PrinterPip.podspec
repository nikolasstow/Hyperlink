Pod::Spec.new do |s|
  s.name           = 'PrinterPip'
  s.version        = '1.0.0'
  s.summary        = 'Picture in Picture of the printer camera or the current layer'
  s.description    = 'Picture in Picture of the printer camera or the current layer'
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
