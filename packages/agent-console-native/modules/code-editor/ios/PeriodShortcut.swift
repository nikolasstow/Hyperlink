import Foundation

/// iOS's period shortcut (". " for a double space) has no place in code, and
/// no text trait turns it off. It comes as ". " over the first space; as that
/// space deleted and then ". " put in where it was; or as "." over that space
/// and then " " after it. This finds it, for the editor to put in the two
/// spaces that were typed instead.
struct PeriodShortcut {
    /// What the editor does with a change.
    enum Action: Equatable {
        /// Let it go in.
        case keep
        /// Put two spaces over this range instead.
        case spaces(NSRange)
        /// Drop it (the shortcut's " ", after its "." was made two spaces).
        case drop
    }

    /// Where a space was just deleted: ". " may come there next.
    private var spaceTakenBackAt: Int?
    /// Where a space was just typed: "." may come over it.
    private var spaceTypedAt: Int?
    /// The shortcut's "." was made two spaces: its " " comes next.
    private var dropsSpace = false

    /// What to do with the change of `range` in `text` to `replacement`. Sees
    /// every change, in order.
    mutating func action(over range: NSRange, in text: NSString, replacement: String) -> Action {
        let overSpace = range.length == 1 && range.upperBound <= text.length && text.substring(with: range) == " "
        let afterTakenBack = range.length == 0 && range.location == spaceTakenBackAt
        let overTyped = overSpace && range.location == spaceTypedAt
        let drops = dropsSpace
        spaceTakenBackAt = replacement.isEmpty && overSpace ? range.location : nil
        spaceTypedAt = replacement == " " && range.length == 0 ? range.location : nil
        dropsSpace = false
        if drops && replacement == " " && range.length == 0 {
            return .drop
        }
        if replacement == ". " && (overSpace || afterTakenBack) {
            return .spaces(range)
        }
        if replacement == "." && overTyped {
            dropsSpace = true
            return .spaces(range)
        }
        return .keep
    }

    /// A change that did not go in (the editor made another).
    mutating func reset() {
        spaceTakenBackAt = nil
        spaceTypedAt = nil
        dropsSpace = false
    }
}
