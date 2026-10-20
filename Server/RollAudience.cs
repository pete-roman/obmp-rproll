using System.Collections.Generic;
using System.Numerics;
using Microsoft.Extensions.Logging;
using OblivionMp.ChatMod.Serverside;
using OblivionMp.Sdk.Common.Archetypes;
using ReadyM.Api.Idents;
using ReadyM.SDK.Archetypes.Core;
using ReadyM.SDK.Attributes;
using ReadyM.SDK.Server.Entities;

namespace RpRoll.Server;

/// <summary>
/// Who gets to see a roll: the roller plus every connected player within <see cref="RangeCentimeters"/> of them
/// in the same area. Kept apart from chat so the dice animation can use the same audience later.
/// </summary>
[Service]
public sealed partial class RollAudience(IChat chat, IEntities entities, ILogger logger)
{
    // Positions are Unreal centimetres, so 20 m = 2000.
    public const float RangeCentimeters = 2000f;

    /// <summary>
    /// The roller plus every connected player whose character is in the same area and within range.
    /// If the roller has no character in the world (still loading), only the roller sees the result.
    /// </summary>
    public List<PlayerId> Of(PlayerId roller)
    {
        List<PlayerId> audience = new() { roller };
        if (!entities.TryLookup<MainCharacter, PlayerId>(roller, out MainCharacter rollerCharacter)
            || !entities.TryGetScope<MainCharacter, Area>(in rollerCharacter, out Area rollerArea))
        {
            logger.LogWarning("RpRoll: {Roller} has no character or area, the roll is shown to the roller only.", roller);
            return audience;
        }
        Vector3 origin = rollerCharacter.Position;

        foreach (ChatPlayer player in chat.ConnectedPlayers)
        {
            if (player.Id == roller)
            {
                continue;
            }
            // Different areas (another interior or worldspace) are never in range, even if the coordinates are close.
            if (entities.TryLookup<MainCharacter, PlayerId>(player.Id, out MainCharacter character)
                && entities.TryGetScope<MainCharacter, Area>(in character, out Area area)
                && area.AreaId == rollerArea.AreaId
                && Vector3.Distance(origin, character.Position) <= RangeCentimeters)
            {
                audience.Add(player.Id);
            }
        }
        return audience;
    }
}
