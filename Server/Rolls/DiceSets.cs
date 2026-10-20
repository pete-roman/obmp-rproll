using System;
using System.Collections.Generic;
using System.Linq;

namespace RpRoll.Server.Rolls;

/// <summary>
/// The cosmetic dice sets, by id. A set is only a look (colours and style), independent of the die type and
/// of the player's race: anyone can pick any set. The server only knows
/// the ids; what each set looks like lives in the dice models on the board page.
/// </summary>
public static class DiceSets
{
    public const string Default = "imperial";

    public static readonly IReadOnlyList<string> All = new[]
    {
        "altmer", "argonian", "ayleid", "bosmer", "breton", "daedric",
        "dunmer", "imperial", "khajiit", "nord", "orc", "redguard",
    };

    public static bool IsKnown(string id) => All.Contains(id, StringComparer.Ordinal);
}
