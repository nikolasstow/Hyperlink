import Foundation

/// iOS's period shortcut (". " for a double space) has no place in code, and
/// no text trait turns it off. It comes as ". " over the first space, or as
/// that space deleted and then ". " put in where it was. This finds it, for
/// the editor to put in the two spaces that were typed instead.
struct PeriodShortcut {
    /// Where a space was just deleted: ". " may come there next.
    private var spaceTakenBackAt: Int?

    /// The range to put two spaces over when the change of `range` in `text`
    /// to `replacement` is the shortcut; nil when it is not. Sees every
    /// change, in order.
    mutating func spaces(over range: NSRange, in text: NSString, replacement: String) -> NSRange? {
        let overSpace = range.length == 1 && range.upperBound <= text.length && text.substring(with: range) == " "
        let afterTakenBack = range.length == 0 && range.location == spaceTakenBackAt
        spaceTakenBackAt = replacement.isEmpty && overSpace ? range.location : nil
        return replacement == ". " && (overSpace || afterTakenBack) ? range : nil
    }

    /// A change that did not go in (the editor made another).
    mutating func reset() {
        spaceTakenBackAt = nil
    }
}
