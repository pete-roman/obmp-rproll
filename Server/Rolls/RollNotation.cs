using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace RpRoll.Server.Rolls;

/// <summary>
/// Reads what a player typed after /roll: "" (1d20), "d20", "2d6", "1d20+2d6". Terms are split on "+",
/// so a modifier term ("+3") can be accepted later in one place; today it gets its own rejection.
/// </summary>
public static class RollNotation
{
    /// <summary>Same limit as the dice tray (<c>TrayRolls.MaxDice</c>): what fits on the board.</summary>
    public const int MaxDicePerRoll = 5;

    public const string UsageMessage = "Can't roll that. Use d6, d10, d20 or d100, e.g. /roll 1d20+2d6 (max 5 dice).";
    public const string TooManyMessage = "Too many dice. Up to 5 per roll.";
    public const string ModifierMessage = "Modifiers like +3 aren't supported yet. Use d6, d10, d20 or d100, e.g. /roll 1d20+2d6.";

    /// <summary>No arguments means one d20.</summary>
    public static readonly IReadOnlyList<DiceGroup> Default = new[] { new DiceGroup(DieType.D20, 1) };

    // Count is optional ("d20" = "1d20"). Sides are only the four dice we support.
    private static readonly Regex DiceTerm = new(@"^(\d*)d(6|10|20|100)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex NumberTerm = new(@"^\d+$", RegexOptions.CultureInvariant);

    /// <summary>
    /// Turns the arguments into dice groups in typed order, or gives the short message to send back.
    /// </summary>
    public static bool TryParse(string arguments, out IReadOnlyList<DiceGroup> groups, out string error)
    {
        groups = Default;
        error = string.Empty;
        string trimmed = arguments.Trim();
        if (trimmed.Length == 0)
        {
            return true;
        }

        List<DiceGroup> parsed = new();
        int totalDice = 0;
        foreach (string part in trimmed.Split('+'))
        {
            string term = part.Trim();
            if (NumberTerm.IsMatch(term) && parsed.Count > 0)
            {
                error = ModifierMessage;
                return false;
            }
            Match match = DiceTerm.Match(term);
            if (!match.Success)
            {
                error = UsageMessage;
                return false;
            }

            int count = 1;
            string countText = match.Groups[1].Value;
            if (countText.Length > 0 && !int.TryParse(countText, NumberStyles.None, CultureInfo.InvariantCulture, out count))
            {
                error = TooManyMessage; // more digits than an int holds
                return false;
            }
            if (count < 1)
            {
                error = UsageMessage;
                return false;
            }
            totalDice += count;
            if (totalDice > MaxDicePerRoll)
            {
                error = TooManyMessage;
                return false;
            }

            DieType type = (DieType)int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
            parsed.Add(new DiceGroup(type, count));
        }

        groups = parsed;
        return true;
    }
}
