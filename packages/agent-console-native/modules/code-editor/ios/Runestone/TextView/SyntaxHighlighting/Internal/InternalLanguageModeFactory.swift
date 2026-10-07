import Foundation

enum InternalLanguageModeFactory {
    static func internalLanguageMode(from languageMode: LanguageMode, stringView: StringView, lineManager: LineManager) -> InternalLanguageMode {
        switch languageMode {
        case is PlainTextLanguageMode:
            return PlainTextInternalLanguageMode()
        case let languageMode as ShikiLanguageMode:
            return ShikiInternalLanguageMode(store: languageMode.store)
        default:
            fatalError("\(languageMode) is not a supported language mode")
        }
    }
}
