using System;
using System.Collections.Generic;
using System.Linq;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;
using RpRoll.Server.Rolls;

namespace RpRoll.Server;

/// <summary>How many of each die, in the tray's order: d6, d10, d20, d100. All zero means "what is in the tray".</summary>
public readonly record struct TrayPick(int D6, int D10, int D20, int D100)
{
    public static readonly TrayPick AsInTray = new(0, 0, 0, 0);

    public int Total => D6 + D10 + D20 + D100;

    /// <summary>A /roll's groups as a tray pick (the tray has no typed order). False if a die isn't one of the four.</summary>
    public static bool TryFrom(IEnumerable<DiceGroup> groups, out TrayPick pick)
    {
        pick = AsInTray;
        foreach (DiceGroup g in groups)
        {
            switch (g.Type)
            {
                case DieType.D6: pick = pick with { D6 = pick.D6 + g.Count }; break;
                case DieType.D10: pick = pick with { D10 = pick.D10 + g.Count }; break;
                case DieType.D20: pick = pick with { D20 = pick.D20 + g.Count }; break;
                case DieType.D100: pick = pick with { D100 = pick.D100 + g.Count }; break;
                default: return false;
            }
        }
        return true;
    }
}

/// <summary>
/// What the server knows about each player's dice board: whether it is open (the client says so, RpRollRpc.BoardState),
/// and how to reach it (/board toggles it; /roll with the board open throws on it). The sending itself is set up by
/// <see cref="RpRollRpcHandlers"/>' side (<see cref="BoardLinkWiring"/>), so the tests can use this class alone.
/// </summary>
[Service]
public sealed partial class BoardLink
{
    // PlayerId changes on reconnect; a stale entry only means a closed board looks open until the next BoardState.
    private readonly HashSet<PlayerId> _open = new();

    /// <summary>Sends RpRollRpc.TrayThrow to the player. Set by BoardLinkWiring.</summary>
    public Action<PlayerId, TrayPick>? SendThrow { get; set; }

    /// <summary>Sends RpRollRpc.ToggleBoard to the player. Set by BoardLinkWiring.</summary>
    public Action<PlayerId>? SendToggle { get; set; }

    /// <summary>Sends RpRollRpc.PresentRoll to the player (dice, values, reason). Set by BoardLinkWiring.</summary>
    public Action<PlayerId, TrayPick, int[], string>? SendPresent { get; set; }

    public bool IsOpen(PlayerId player) => _open.Contains(player);

    public void SetOpen(PlayerId player, bool open)
    {
        if (open)
        {
            _open.Add(player);
        }
        else
        {
            _open.Remove(player);
        }
    }

    public void Throw(PlayerId player, TrayPick pick) => SendThrow?.Invoke(player, pick);

    public void Toggle(PlayerId player) => SendToggle?.Invoke(player);

    /// <summary>Shows a roll the server already made (another mod's, see <see cref="RpRollApi"/>) on the player's screen.</summary>
    public void Present(PlayerId player, TrayPick pick, int[] values, string reason) => SendPresent?.Invoke(player, pick, values, reason);

    internal IReadOnlyCollection<PlayerId> OpenBoards => _open.ToArray();
}

/// <summary>Connects <see cref="BoardLink"/> to the generated RPC sends.</summary>
[Service]
public sealed partial class BoardLinkWiring(BoardLink board, RpRollRpcHandlers rpc)
{
    private void Start()
    {
        board.SendThrow = (player, pick) => rpc.SendTrayThrow(player, pick.D6, pick.D10, pick.D20, pick.D100);
        board.SendToggle = player => rpc.SendToggleBoard(player);
        board.SendPresent = (player, pick, values, reason) => rpc.SendPresentRoll(player, reason, pick.D6, pick.D10, pick.D20, pick.D100, values);
    }
}
