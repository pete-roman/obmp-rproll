using System;
using System.Text.RegularExpressions;

namespace RpRoll.Client;

/// <summary>
/// Recognises the exact roll line RpRoll.Server sends (its <c>RollChatFormat</c>; change both together):
/// "Pete rolled 1d20 + 2d6: d20 [14], d6 [3], d6 [5] = 22", or for another mod "Pete rolled 5d20 for Lazy: ... = 47"
/// (the reason as <c>RollChatFormat.CleanReason</c> leaves it). No SDK types, so the tests can use it directly.
/// </summary>
public static class RollLineFilter
{
    private const string Die = @"d(?:6|10|20|100)";

    private static readonly Regex RollLine = new(
        $@"^.+ rolled \d+{Die}(?: \+ \d+{Die})*(?: for [\p{{L}}\p{{Nd}}' -]{{1,40}})?: {Die} \[\d+\](?:, {Die} \[\d+\])* = \d+$",
        RegexOptions.CultureInvariant);

    /// <summary>
    /// True only for a roll line. "/me" lines start with "* ", so "/me rolled 1d20: d20 [20] = 20" is not a roll.
    /// The caller also checks that the line came from the server as an Action line.
    /// </summary>
    public static bool IsRollText(string? text)
    {
        return text is not null
            && !text.StartsWith("* ", StringComparison.Ordinal)
            && RollLine.IsMatch(text);
    }

    /// <summary>
    /// Whether a delivered chat line goes to the HUD: a roll line, sent by the server as an Action line, and only
    /// while the chat window is closed. With chat open the player already sees the line there, and a native HUD
    /// message on top of the open chat is the suspected cause of chat losing the keyboard.
    /// </summary>
    public static bool ShouldShowOnHud(bool fromServer, bool isAction, string? text, bool chatOpen)
    {
        return fromServer && isAction && !chatOpen && IsRollText(text);
    }
}
