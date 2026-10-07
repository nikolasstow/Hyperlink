import Foundation

/// The internal counterpart of `ShikiLanguageMode`: no syntax tree (modelled on
/// PlainText), but its line highlighter colours from the Shiki token store.
final class ShikiInternalLanguageMode: InternalLanguageMode {
    private let store: ShikiTokenStore

    init(store: ShikiTokenStore) {
        self.store = store
    }

    func parse(_ text: NSString) {}

    func parse(_ text: NSString, completion: @escaping ((Bool) -> Void)) {
        completion(true)
    }

    func textDidChange(_ change: TextChange) -> LineChangeSet {
        LineChangeSet()
    }

    func tokenType(at location: Int) -> String? {
        nil
    }

    func createLineSyntaxHighlighter() -> LineSyntaxHighlighter {
        ShikiSyntaxHighlighter(store: store)
    }

    func highestSyntaxNode(at linePosition: LinePosition) -> SyntaxNode? {
        nil
    }

    func syntaxNode(at linePosition: LinePosition) -> SyntaxNode? {
        nil
    }

    func currentIndentLevel(of line: DocumentLineNode, using indentStrategy: IndentStrategy) -> Int {
        0
    }

    func strategyForInsertingLineBreak(
        from startLinePosition: LinePosition,
        to endLinePosition: LinePosition,
        using indentStrategy: IndentStrategy) -> InsertLineBreakIndentStrategy {
        InsertLineBreakIndentStrategy(indentLevel: 0, insertExtraLineBreak: false)
    }

    func detectIndentStrategy() -> DetectedIndentStrategy {
        .unknown
    }
}
