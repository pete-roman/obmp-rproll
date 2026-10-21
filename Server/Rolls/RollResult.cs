using System;
using System.Collections.Generic;
using ReadyM.Api.Idents;

namespace RpRoll.Server.Rolls;

/// <summary>One die after the roll.</summary>
public readonly record struct DieResult(DieType Type, int Value);

/// <summary>
/// A finished roll. Every consumer (chat today, the dice animation and UI later) reads this, never the chat text.
/// </summary>
/// <param name="Roller">Who rolled.</param>
/// <param name="DiceSet">The cosmetic dice set the roller had selected (see <see cref="DiceSets"/>). Chat ignores it.</param>
/// <param name="Groups">What was asked for, in typed order.</param>
/// <param name="Dice">Each die and its value, in the same order as <paramref name="Groups"/>.</param>
/// <param name="Total">Sum of all dice. A modifier would be added here later.</param>
/// <param name="RolledAt">Server time of the roll, UTC.</param>
/// <param name="Reason">What another mod rolled for ("Lazy"), or null for a player's own roll.</param>
public sealed record RollResult(
    PlayerId Roller,
    string DiceSet,
    IReadOnlyList<DiceGroup> Groups,
    IReadOnlyList<DieResult> Dice,
    int Total,
    DateTimeOffset RolledAt,
    string? Reason = null);
