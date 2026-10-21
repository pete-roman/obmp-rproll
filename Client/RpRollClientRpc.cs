using System;
using Microsoft.Extensions.Logging;
using ReadyM.SDK.Attributes;
using RpRoll.Common;

namespace RpRoll.Client;

/// <summary>
/// Client half of <see cref="RpRollRpc"/>. <c>SendRollDice</c> and <c>SendBoardState</c> (generated) go to the server;
/// the answers and the server's /board and /roll requests come back here and go to <see cref="DiceTray"/>.
/// </summary>
[RpcHandlersFor(typeof(RpRollRpc))]
public sealed partial class RpRollClientRpc(ILogger logger)
{
    public event Action<long, int[]>? Rolled;

    public event Action<long, string>? Refused;

    public event Action? Toggle;

    /// <summary>d6, d10, d20, d100 to put in the tray before throwing; all zero: throw the tray as it is.</summary>
    public event Action<int, int, int, int>? Throw;

    /// <summary>A roll the server made for another mod: reason, d6, d10, d20, d100 and the values to show.</summary>
    public event Action<string, int, int, int, int, int[]>? Present;

    partial void OnDiceRolled(long requestId, int[] values)
    {
        logger.LogInformation("[RpRoll] Tray #{RequestId} from the server: {Values}", requestId, string.Join(", ", values));
        Raise(() => Rolled?.Invoke(requestId, values));
    }

    partial void OnDiceRefused(long requestId, string reason)
    {
        logger.LogInformation("[RpRoll] Tray #{RequestId} refused by the server: {Reason}", requestId, reason);
        Raise(() => Refused?.Invoke(requestId, reason));
    }

    partial void OnToggleBoard()
    {
        logger.LogInformation("[RpRoll] /board from chat.");
        Raise(() => Toggle?.Invoke());
    }

    partial void OnTrayThrow(int d6, int d10, int d20, int d100)
    {
        logger.LogInformation("[RpRoll] /roll from chat for the board: {D6} d6, {D10} d10, {D20} d20, {D100} d100.", d6, d10, d20, d100);
        Raise(() => Throw?.Invoke(d6, d10, d20, d100));
    }

    partial void OnPresentRoll(string reason, int d6, int d10, int d20, int d100, int[] values)
    {
        logger.LogInformation("[RpRoll] A roll for {Reason} to show: {Values}", reason, string.Join(", ", values));
        Raise(() => Present?.Invoke(reason, d6, d10, d20, d100, values));
    }

    private void Raise(Action raise)
    {
        try
        {
            raise();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "[RpRoll] Handling a message from the server failed.");
        }
    }
}
