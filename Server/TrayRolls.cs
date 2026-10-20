using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;
using RpRoll.Server.Rolls;

namespace RpRoll.Server;

/// <summary>What the server answers to one dice tray request.</summary>
public readonly record struct TrayOutcome(bool Accepted, int[] Values, string Reason)
{
    public static TrayOutcome Rolled(int[] values) => new(true, values, string.Empty);

    public static TrayOutcome Refused(string reason) => new(false, Array.Empty<int>(), reason);
}

/// <summary>
/// The dice board (Space in game, <see cref="RpRollRpcHandlers"/>): 1 to <see cref="MaxDice"/> d6, d10, d20 and d100 through
/// <see cref="RollService"/>, so the chat line reaches players in range exactly as for /roll. The server checks the
/// counts itself: the client only says how many of each. A player can't throw again while the last throw is still on
/// the board (<see cref="Cooldown"/>). Kept apart from the RPC class so the tests can run it.
/// </summary>
[Service]
public sealed partial class TrayRolls(RollService rolls, ILogger logger)
{
    /// <summary>What fits on the board and still reads at a glance. /roll has the same limit.</summary>
    public const int MaxDice = RollNotation.MaxDicePerRoll;

    /// <summary>About as long as a throw takes to settle on the board.</summary>
    public static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(1.5);

    public const string TooSoonMessage = "The dice are still rolling.";

    public const string InvalidMessage = "Pick 1 to 5 dice.";

    public const string FailedMessage = "That roll didn't work. Try again.";

    // PlayerId changes on reconnect, which only resets the cooldown: nothing here is kept for long.
    private readonly Dictionary<PlayerId, DateTimeOffset> _lastRoll = new();

    public TrayOutcome Roll(PlayerId sender, TrayPick pick) => Roll(sender, pick, DateTimeOffset.UtcNow);

    /// <summary>
    /// Never throws: anything that goes wrong is logged and refused, so the next throw still works.
    /// Values come back in the tray's order, d6s, d10s, d20s, d100s, which is also the order of the chat line.
    /// </summary>
    internal TrayOutcome Roll(PlayerId sender, TrayPick pick, DateTimeOffset now)
    {
        try
        {
            if (pick.D6 < 0 || pick.D10 < 0 || pick.D20 < 0 || pick.D100 < 0
                || pick.D6 > MaxDice || pick.D10 > MaxDice || pick.D20 > MaxDice || pick.D100 > MaxDice
                || pick.Total < 1 || pick.Total > MaxDice)
            {
                return TrayOutcome.Refused(InvalidMessage);
            }
            if (_lastRoll.TryGetValue(sender, out DateTimeOffset last) && now - last < Cooldown)
            {
                return TrayOutcome.Refused(TooSoonMessage);
            }
            _lastRoll[sender] = now;
            List<DiceGroup> groups = new();
            if (pick.D6 > 0) groups.Add(new DiceGroup(DieType.D6, pick.D6));
            if (pick.D10 > 0) groups.Add(new DiceGroup(DieType.D10, pick.D10));
            if (pick.D20 > 0) groups.Add(new DiceGroup(DieType.D20, pick.D20));
            if (pick.D100 > 0) groups.Add(new DiceGroup(DieType.D100, pick.D100));
            RollResult result = rolls.Roll(new RollRequest(sender, groups));
            return TrayOutcome.Rolled(result.Dice.Select(die => die.Value).ToArray());
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "RpRoll: tray roll for {Sender} failed.", sender);
            return TrayOutcome.Refused(FailedMessage);
        }
    }
}
