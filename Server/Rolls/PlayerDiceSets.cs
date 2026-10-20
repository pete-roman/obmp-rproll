using System;
using System.Collections.Generic;
using ReadyM.Api.Idents;
using ReadyM.Relay.Server.Sdk.Players;
using ReadyM.SDK.Attributes;

namespace RpRoll.Server.Rolls;

/// <summary>
/// Placeholder for each player's selected dice set. Keyed by ReadyM account id, because PlayerId changes on
/// every reconnect. Kept in memory only: nothing sets it yet (no UI, no command), so everyone gets
/// <see cref="DiceSets.Default"/>. Saving it to disk comes with the selection UI.
/// </summary>
[Service]
public sealed partial class PlayerDiceSets(IPlayers players)
{
    private readonly Dictionary<Guid, string> _selected = new();

    public string Get(PlayerId player)
    {
        return players.GetReadyMId(player) is Guid account && _selected.TryGetValue(account, out string? set)
            ? set
            : DiceSets.Default;
    }

    /// <summary>False for an unknown set, or a player without a ReadyM id.</summary>
    public bool TrySet(PlayerId player, string set)
    {
        if (!DiceSets.IsKnown(set) || players.GetReadyMId(player) is not Guid account)
        {
            return false;
        }
        _selected[account] = set;
        return true;
    }
}
