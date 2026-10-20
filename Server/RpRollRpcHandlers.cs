using System;
using Microsoft.Extensions.Logging;
using ReadyM.Relay.Server.Sdk.Rpc;
using ReadyM.SDK.Attributes;
using RpRoll.Common;

namespace RpRoll.Server;

/// <summary>
/// Server half of <see cref="RpRollRpc"/>: rolls the dice board's dice with <see cref="TrayRolls"/> and answers the
/// sender only (the chat line for everyone in range comes from <see cref="RollChat"/>, as for /roll), and keeps
/// <see cref="BoardLink"/> told whether each player's board is open.
/// </summary>
[RpcHandlersFor(typeof(RpRollRpc))]
public sealed partial class RpRollRpcHandlers(TrayRolls tray, BoardLink board, ILogger logger)
{
    partial void OnBoardState(RpcContext context, bool open)
    {
        board.SetOpen(context.Sender, open);
    }

    partial void OnRollDice(RpcContext context, long requestId, int d6, int d10, int d20, int d100)
    {
        TrayOutcome outcome = tray.Roll(context.Sender, new TrayPick(d6, d10, d20, d100));
        try
        {
            if (outcome.Accepted)
            {
                SendDiceRolled(context.Sender, requestId, outcome.Values);
                logger.LogInformation("RpRoll: tray #{RequestId} for {Sender} ({D6} d6, {D10} d10, {D20} d20, {D100} d100): {Values}",
                    requestId, context.Sender, d6, d10, d20, d100, string.Join(", ", outcome.Values));
            }
            else
            {
                SendDiceRefused(context.Sender, requestId, outcome.Reason);
                logger.LogInformation("RpRoll: tray #{RequestId} for {Sender} ({D6} d6, {D10} d10, {D20} d20, {D100} d100) refused: {Reason}",
                    requestId, context.Sender, d6, d10, d20, d100, outcome.Reason);
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "RpRoll: answering tray #{RequestId} for {Sender} failed.", requestId, context.Sender);
        }
    }
}
