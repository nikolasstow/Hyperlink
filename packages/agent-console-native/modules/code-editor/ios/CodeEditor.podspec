Pod::Spec.new do |s|
  s.name           = 'CodeEditor'
  s.version        = '1.0.0'
  s.summary        = 'A native code editor view (UITextView + TextKit) with a line-number gutter and token highlighting'
  s.description    = 'A UIKit text editor the app drives: editable or read-only, monospaced, no-wrap, with a gutter and syntax colours applied from Shiki tokens passed as JSON.'
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
