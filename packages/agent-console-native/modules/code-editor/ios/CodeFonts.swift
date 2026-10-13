import CoreText
import Foundation

/// Fonts installed for this run of the app from files on the device (the
/// custom code fonts the app downloads): registered with the system for the
/// process, so every view can draw in them by family name.
enum CodeFonts {
    /// Posted after fonts are registered or removed; editors redraw.
    static let changed = Notification.Name("CodeFontsChanged")

    /// Registers the font file at `uri` and returns the families it holds
    /// (empty if it holds none). A file already registered counts as done.
    static func register(_ uri: String) throws -> [String] {
        guard let url = URL(string: uri) else {
            throw CodeFontsError.badURI(uri)
        }
        let descriptors = (CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor]) ?? []
        let families = descriptors.compactMap { CTFontDescriptorCopyAttribute($0, kCTFontFamilyNameAttribute) as? String }
        guard !families.isEmpty else {
            throw CodeFontsError.notAFont(uri)
        }
        var error: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error), let cfError = error?.takeRetainedValue() {
            let code = CFErrorGetCode(cfError)
            guard code == CTFontManagerError.alreadyRegistered.rawValue else {
                throw CodeFontsError.registration(uri, CFErrorCopyDescription(cfError) as String)
            }
        }
        NotificationCenter.default.post(name: changed, object: nil)
        return Array(Set(families)).sorted()
    }

    /// Unregisters the font file at `uri` (a font being removed).
    static func unregister(_ uri: String) {
        guard let url = URL(string: uri) else {
            return
        }
        CTFontManagerUnregisterFontsForURL(url as CFURL, .process, nil)
        NotificationCenter.default.post(name: changed, object: nil)
    }
}

enum CodeFontsError: LocalizedError {
    case badURI(String)
    case notAFont(String)
    case registration(String, String)

    var errorDescription: String? {
        switch self {
        case let .badURI(uri):
            return "Not a file URL: \(uri)"
        case let .notAFont(uri):
            return "No font in \(uri)"
        case let .registration(uri, reason):
            return "Registering \(uri) failed: \(reason)"
        }
    }
}
