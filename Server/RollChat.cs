using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using OblivionMp.ChatMod.Common;
using OblivionMp.ChatMod.Serverside;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;
using RpRoll.Server.Rolls;

namespace RpRoll.Server;

/// <summary>
/// Chat as a consumer of <see cref="RollService.Rolled"/>: one line per roll, sent to the <see cref="RollAudience"/>.
/// </summary>
[Service]
public sealed partial class RollChat(RollService rolls, RollAudience audience, IChat chat, ILogger logger)
{
    private void Start()
    {
        rolls.Rolled += Show;
    }

    private void Stop()
    {
        rolls.Rolled -= Show;
    }

    private void Show(RollResult result)
    {
        string name = chat.GetNickname(result.Roller);
        if (name.Length == 0)
        {
            name = "Someone";
        }
        string text = RollChatFormat.Line(name, result);

        List<PlayerId> players = audience.Of(result.Roller);
        foreach (PlayerId player in players)
        {
            chat.SendTo(player, text, ChatLineKind.Action);
        }
        logger.LogInformation("RpRoll: {Text} (shown to {Count} player(s))", text, players.Count);
    }
}
