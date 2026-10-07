import Foundation

/// Highlights from Shiki tokens pushed in via its `store`, instead of
/// Tree-sitter. The editor keeps one store and updates it as JS re-tokenises.
public final class ShikiLanguageMode: LanguageMode {
    let store: ShikiTokenStore

    init(store: ShikiTokenStore) {
        self.store = store
    }
}
