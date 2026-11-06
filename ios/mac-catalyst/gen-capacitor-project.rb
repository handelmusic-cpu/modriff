#!/usr/bin/env ruby
# Writes an Xcode project that builds Capacitor and Cordova from the sources in
# node_modules/@capacitor/ios as frameworks. build-capacitor-xcframeworks.sh
# builds it for Mac Catalyst and adds that slice to the official xcframeworks.
# Why it exists: Capacitor's prebuilt binaries (capacitor-swift-pm) carry only
# ios-arm64 and the iOS simulator, so the app could not link as a Mac app. The
# npm package ships no .xcodeproj, and SwiftPM cannot build Capacitor (Swift and
# Objective-C in one module), so the project is generated here.
#
# usage: gen-capacitor-project.rb <capacitor-ios-dir> <out-dir>
require 'xcodeproj'
require 'fileutils'

src, out = ARGV
abort 'usage: gen-capacitor-project.rb <@capacitor/ios dir> <out dir>' unless src && out
src = File.expand_path(src)
out = File.expand_path(out)
FileUtils.mkdir_p(out)

cap_dir = File.join(src, 'Capacitor/Capacitor')
cdv_dir = File.join(src, 'CapacitorCordova/CapacitorCordova')

proj = Xcodeproj::Project.new(File.join(out, 'CapMac.xcodeproj'))
proj.root_object.attributes['LastUpgradeCheck'] = '2700'

def framework_target(proj, name, plist, deployment)
  t = proj.new_target(:framework, name, :ios, deployment)
  t.build_configurations.each do |c|
    s = c.build_settings
    s['PRODUCT_NAME'] = name
    s['PRODUCT_BUNDLE_IDENTIFIER'] = "com.ionic.#{name}"
    s['INFOPLIST_FILE'] = plist
    s['DEFINES_MODULE'] = 'YES'
    s['SUPPORTS_MACCATALYST'] = 'YES'
    s['SUPPORTED_PLATFORMS'] = 'iphoneos iphonesimulator'
    s['SKIP_INSTALL'] = 'NO'
    s['BUILD_LIBRARY_FOR_DISTRIBUTION'] = 'YES'
    s['CODE_SIGN_STYLE'] = 'Manual'
    s['CODE_SIGN_IDENTITY'] = '-'
    s['SWIFT_VERSION'] = '5.0'
    s['CLANG_ENABLE_MODULES'] = 'YES'
    s['GCC_C_LANGUAGE_STANDARD'] = 'gnu11'
    s['CLANG_ENABLE_OBJC_ARC'] = 'YES'
    # Same as the official build: -O, no debug-only code in the binary.
    s['SWIFT_OPTIMIZATION_LEVEL'] = '-O'
    s['GCC_OPTIMIZATION_LEVEL'] = 's'
    s['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
  end
  t
end

# --- Cordova ---------------------------------------------------------------
cdv = framework_target(proj, 'Cordova', File.join(cdv_dir, 'Info.plist'), '15.0')
cdv_group = proj.main_group.new_group('Cordova', cdv_dir)
public_h = Dir[File.join(cdv_dir, 'Classes/Public/*.h')].sort
public_h << File.join(cdv_dir, 'CapacitorCordova.h')
sources_m = Dir[File.join(cdv_dir, 'Classes/Public/*.m')].sort
sources_m.each { |f| cdv.add_file_references([cdv_group.new_file(f)]) }
public_h.each do |f|
  ref = cdv_group.new_file(f)
  cdv.headers_build_phase.add_file_reference(ref).settings = { 'ATTRIBUTES' => ['Public'] }
end
cdv_group.new_file(File.join(cdv_dir, 'CapacitorCordova.modulemap'))
cdv.add_resources([cdv_group.new_file(File.join(cdv_dir, 'PrivacyInfo.xcprivacy'))])
cdv.build_configurations.each do |c|
  c.build_settings['MODULEMAP_FILE'] = File.join(cdv_dir, 'CapacitorCordova.modulemap')
  c.build_settings['PRODUCT_MODULE_NAME'] = 'Cordova'
end

# --- Capacitor -------------------------------------------------------------
cap = framework_target(proj, 'Capacitor', File.join(cap_dir, 'Info.plist'), '15.0')
cap_group = proj.main_group.new_group('Capacitor', cap_dir)
swift = Dir[File.join(cap_dir, '**/*.swift')].sort
objc = Dir[File.join(cap_dir, '**/*.m')].sort
(swift + objc).each { |f| cap.add_file_references([cap_group.new_file(f)]) }

public_names = %w[Capacitor.h CAPPlugin.h CAPPluginCall.h CAPBridgedPlugin.h CAPPluginMethod.h
                  CAPInstanceDescriptor.h CAPInstanceConfiguration.h]
private_names = %w[CAPBridgedJSTypes.h]
Dir[File.join(cap_dir, '**/*.h')].sort.each do |f|
  ref = cap_group.new_file(f)
  base = File.basename(f)
  attrs = if public_names.include?(base) then ['Public']
          elsif private_names.include?(base) then ['Private']
          end # anything else stays project-only, as in the official build
  bf = cap.headers_build_phase.add_file_reference(ref)
  bf.settings = { 'ATTRIBUTES' => attrs } if attrs
end
cap_group.new_file(File.join(cap_dir, 'Capacitor.modulemap'))
cap.add_resources([
  cap_group.new_file(File.join(cap_dir, 'assets/native-bridge.js')),
  cap_group.new_file(File.join(cap_dir, 'PrivacyInfo.xcprivacy'))
])
cap.add_dependency(cdv)
cap.frameworks_build_phase.add_file_reference(cdv.product_reference)
cap.build_configurations.each do |c|
  c.build_settings['MODULEMAP_FILE'] = File.join(cap_dir, 'Capacitor.modulemap')
  c.build_settings['PRODUCT_MODULE_NAME'] = 'Capacitor'
  c.build_settings['SWIFT_OBJC_INTERFACE_HEADER_NAME'] = 'Capacitor-Swift.h'
  c.build_settings['FRAMEWORK_SEARCH_PATHS'] = '$(inherited) $(BUILT_PRODUCTS_DIR)'
end

proj.save
puts File.join(out, 'CapMac.xcodeproj')
