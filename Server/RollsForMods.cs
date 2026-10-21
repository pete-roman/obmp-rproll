using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;
using RpRoll.Server.Rolls;

namespace RpRoll.Server;

/// <summary>A roll another mod asked for: each die's value (d6s, d10s, d20s, d100s in that order) and the sum.</summary>
public sealed record ModRoll(int[] Values, int Total);

/// <summary>
/// RpRoll for other server mods (MESOL's trait rolls first). Inject it into a <c>[Service]</c>, with a manifest
/// dependency on <c>RpRoll</c> and a compile-only reference to <c>RpRoll.Server.dll</c>. A roll here is a real RpRoll
/// roll: the server rolls it, players within 20 m get the chat line with the reason ("Pete rolled 5d20 for Lazy: ..."),
/// and with <c>showOnBoard</c> the player's screen shows the dice landing on these numbers in a small board that
/// closes by itself (or on the open board). This class is the stable surface; the rest of RpRoll may change.
/// </summary>
[Service]
public sealed partial class RpRollApi(RollService rolls, BoardLink board, ILogger logger)
{
    /// <summary>
    /// Rolls the given dice for <paramref name="player"/>, 1 to 5 in all. Throws <see cref="ArgumentException"/> for a
    /// pick outside that, so the calling mod finds out at once; the roll itself never fails.
    /// </summary>
    public ModRoll Roll(PlayerId player, int d6, int d10, int d20, int d100, string reason, bool showOnBoard)
    {
        TrayPick pick = new(d6, d10, d20, d100);
        if (d6 < 0 || d10 < 0 || d20 < 0 || d100 < 0 || pick.Total < 1 || pick.Total > TrayRolls.MaxDice)
        {
            throw new ArgumentException($"RpRoll rolls 1 to {TrayRolls.MaxDice} dice, not {d6} d6, {d10} d10, {d20} d20, {d100} d100.");
        }
        List<DiceGroup> groups = new();
        if (d6 > 0) groups.Add(new DiceGroup(DieType.D6, d6));
        if (d10 > 0) groups.Add(new DiceGroup(DieType.D10, d10));
        if (d20 > 0) groups.Add(new DiceGroup(DieType.D20, d20));
        if (d100 > 0) groups.Add(new DiceGroup(DieType.D100, d100));
        string cleanReason = RollChatFormat.CleanReason(reason);
        RollResult result = rolls.Roll(new RollRequest(player, groups, cleanReason.Length > 0 ? cleanReason : null));
        int[] values = result.Dice.Select(die => die.Value).ToArray();
        if (showOnBoard)
        {
            try
            {
                board.Present(player, pick, values, cleanReason);
            }
            catch (Exception exception)
            {
                // The roll stands and is in chat; only the dice on screen are missing.
                logger.LogError(exception, "RpRoll: showing {Reason} on {Player}'s board failed.", cleanReason, player);
            }
        }
        return new ModRoll(values, result.Total);
    }
}
