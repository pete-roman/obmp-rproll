using System;
using System.Collections.Generic;

namespace RpRoll.Server.Rolls;

/// <summary>
/// The roll itself, with the random source passed in, so tests can use fixed numbers.
/// <see cref="RollService"/> calls it with the real random source.
/// </summary>
public static class DiceRoller
{
    /// <param name="rollDie">Returns 1 to the die's sides, inclusive.</param>
    public static RollResult Roll(RollRequest request, string diceSet, Func<DieType, int> rollDie, DateTimeOffset now)
    {
        List<DieResult> dice = new();
        int total = 0;
        foreach (DiceGroup group in request.Groups)
        {
            for (int i = 0; i < group.Count; i++)
            {
                int value = rollDie(group.Type);
                dice.Add(new DieResult(group.Type, value));
                total += value;
            }
        }
        return new RollResult(request.Roller, diceSet, request.Groups, dice, total, now, request.Reason);
    }
}
