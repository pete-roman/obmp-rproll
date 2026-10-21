using System.Linq;

namespace RpRoll.Server.Rolls;

/// <summary>
/// The chat line for a roll. RpRoll.Client's <c>RollLineFilter</c> matches this exact shape for the HUD,
/// so change both together.
/// </summary>
public static class RollChatFormat
{
    /// <summary>The longest reason another mod can put in a roll line ("for Lazy").</summary>
    public const int MaxReasonLength = 40;

    /// <summary>
    /// "Pete rolled 1d20 + 2d6: d20 [14], d6 [3], d6 [5] = 22". Always the full form, also for one die. A roll another
    /// mod asked for says what it was for: "Pete rolled 5d20 for Lazy: d20 [3], ... = 47".
    /// </summary>
    public static string Line(string rollerName, RollResult result)
    {
        string asked = string.Join(" + ", result.Groups.Select(group => $"{group.Count}d{(int)group.Type}"));
        string dice = string.Join(", ", result.Dice.Select(die => $"d{(int)die.Type} [{die.Value}]"));
        string reason = CleanReason(result.Reason);
        string purpose = reason.Length > 0 ? $" for {reason}" : string.Empty;
        return $"{rollerName} rolled {asked}{purpose}: {dice} = {result.Total}";
    }

    /// <summary>A reason fit for the line: letters, digits, spaces, apostrophes and hyphens only, at most 40 characters.</summary>
    public static string CleanReason(string? reason)
    {
        string kept = new((reason ?? string.Empty).Where(c => char.IsLetterOrDigit(c) || c is ' ' or '\'' or '-').ToArray());
        kept = string.Join(' ', kept.Split(' ', System.StringSplitOptions.RemoveEmptyEntries));
        return kept.Length <= MaxReasonLength ? kept : kept[..MaxReasonLength].TrimEnd();
    }
}
