using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using OblivionMp.ChatMod.Common;
using OblivionMp.ChatMod.Serverside;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;
using RpRoll.Server.Rolls;

namespace RpRoll.Server;

/// <summary>
/// /roll [dice] and /board.
/// <para>/roll reads what the player typed. With the player's dice board closed it hands the dice to
/// <see cref="RollService"/> (showing the result is <see cref="RollChat"/>'s job). With the board open it sends the
/// dice to the board instead, which throws them like Space does (the roll then comes back through
/// <see cref="TrayRolls"/>, so it is rolled and shown once).</para>
/// <para>/board shows or hides the player's dice board, like Home.</para>
/// Registered with chat's <see cref="IChat.AddCommand"/>.
/// </summary>
[Service]
public sealed partial class RollCommand(IChat chat, RollService rolls, BoardLink board, ILogger logger)
{
    private const string Usage = "/roll [dice] - roll d6, d10, d20 or d100, e.g. /roll, /roll 2d10 or /roll 1d20+2d6 (up to 5 dice), shown to players within 20 m. With the dice board open, the dice are thrown on it";
    private const string BoardUsage = "/board - show or hide the dice board (Home does the same)";

    private void Start()
    {
        chat.AddCommand("roll", Usage, Roll);
        chat.AddCommand("board", BoardUsage, Board);
        logger.LogInformation("RpRoll: /roll registered, d6/d10/d20/d100, up to {Max} dice, range {Range} m. /board registered.",
            RollNotation.MaxDicePerRoll, RollAudience.RangeCentimeters / 100f);
    }

    private const string FailedMessage = "That roll didn't work. Try again.";

    /// <summary>
    /// The /roll handler. Internal so the tests can run it too.
    /// Never throws: whatever goes wrong is logged here and the player gets a short message, so one bad roll
    /// can't affect the next one or anyone else's commands.
    /// </summary>
    internal void Roll(IChat chat, PlayerId sender, string arguments)
    {
        try
        {
            if (!RollNotation.TryParse(arguments ?? string.Empty, out IReadOnlyList<DiceGroup> groups, out string error))
            {
                chat.SendTo(sender, error, ChatLineKind.Rejection);
                logger.LogInformation("RpRoll: rejected '/roll {Arguments}' from {Sender}: {Error}", arguments, sender, error);
                return;
            }
            if (board.IsOpen(sender))
            {
                // No arguments: throw what is in the tray. Arguments: put those dice in the tray and throw them.
                TrayPick pick = TrayPick.AsInTray;
                if ((arguments ?? string.Empty).Trim().Length > 0 && !TrayPick.TryFrom(groups, out pick))
                {
                    chat.SendTo(sender, RollNotation.UsageMessage, ChatLineKind.Rejection);
                    return;
                }
                board.Throw(sender, pick);
                logger.LogInformation("RpRoll: '/roll {Arguments}' from {Sender} goes to the open dice board.", arguments, sender);
                return;
            }
            rolls.Roll(new RollRequest(sender, groups));
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "RpRoll: '/roll {Arguments}' from {Sender} failed.", arguments, sender);
            try
            {
                chat.SendTo(sender, FailedMessage, ChatLineKind.Rejection);
            }
            catch (Exception sendException)
            {
                logger.LogError(sendException, "RpRoll: could not tell {Sender} that the roll failed.", sender);
            }
        }
    }

    /// <summary>The /board handler. Never throws.</summary>
    internal void Board(IChat chat, PlayerId sender, string arguments)
    {
        try
        {
            board.Toggle(sender);
            logger.LogInformation("RpRoll: /board from {Sender}.", sender);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "RpRoll: /board from {Sender} failed.", sender);
        }
    }
}
