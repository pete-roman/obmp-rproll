using ReadyM.Api.Multiplayer;
using ReadyM.SDK.Attributes;

namespace RpRoll.Common;

/// <summary>
/// The dice board (Home in game). Every count is in the tray's order: d6, d10, d20, d100.
/// The client asks for the dice picked in the tray, the server rolls them with <c>RollService</c> and answers the
/// roller only. Players in range get the usual chat line from the server, so nobody else needs these messages.
/// The client says whether its board is open, so /roll from chat can throw on it, and /board can toggle it.
/// No [ClientToClients]: ServerRpcManifest.ClientOffset is never assigned in OB:MP 1.0 (API.md, Delta rc.2).
/// </summary>
[RpcContracts]
public static partial class RpRollRpc
{
    /// <summary>Roll these dice for the sender, 1 to 5 in all. <paramref name="requestId"/> comes back in the answer.</summary>
    [ClientToServer]
    public static partial void RollDice(long requestId, int d6, int d10, int d20, int d100);

    /// <summary>The server's dice for the request, in the order d6s, d10s, d20s, d100s.</summary>
    [ServerToClient]
    public static partial void DiceRolled(long requestId, int[] values);

    /// <summary>No roll for the request (too soon, not a valid pick, or the roll failed). The reason is shown as is.</summary>
    [ServerToClient]
    public static partial void DiceRefused(long requestId, string reason);

    /// <summary>The client's dice board was opened or closed.</summary>
    [ClientToServer]
    public static partial void BoardState(bool open);

    /// <summary>/board: show or hide the dice board.</summary>
    [ServerToClient]
    public static partial void ToggleBoard();

    /// <summary>/roll with the board open: put these dice in the tray and throw them. All zero: throw the tray as it is.</summary>
    [ServerToClient]
    public static partial void TrayThrow(int d6, int d10, int d20, int d100);

    /// <summary>
    /// A roll the server already made for another mod (MESOL's traits): show these dice landing on these values, in a
    /// small board that closes by itself, or on the board if it is open. <paramref name="reason"/> says what it was for.
    /// </summary>
    [ServerToClient]
    public static partial void PresentRoll(string reason, int d6, int d10, int d20, int d100, int[] values);
}
