Pod::Spec.new do |s|
  s.name           = 'ContextMenu'
  s.version        = '1.0.0'
  s.summary        = 'A view that opens the iOS context menu on a long press'
  s.description    = 'A UIView that adds UIContextMenuInteraction around its React Native children'
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
