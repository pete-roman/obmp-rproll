using System.Linq;

namespace RpRoll.Server.Rolls;

/// <summary>
/// The chat line for a roll. RpRoll.Client's <c>RollLineFilter</c> matches this exact shape for the HUD,
/// so change both together.
/// </summary>
public static class RollChatFormat
{
    /// <summary>"Pete rolled 1d20 + 2d6: d20 [14], d6 [3], d6 [5] = 22". Always the full form, also for one die.</summary>
    public static string Line(string rollerName, RollResult result)
    {
        string asked = string.Join(" + ", result.Groups.Select(group => $"{group.Count}d{(int)group.Type}"));
        string dice = string.Join(", ", result.Dice.Select(die => $"d{(int)die.Type} [{die.Value}]"));
        return $"{rollerName} rolled {asked}: {dice} = {result.Total}";
    }
}
