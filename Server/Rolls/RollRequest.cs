using System.Collections.Generic;
using ReadyM.Api.Idents;

namespace RpRoll.Server.Rolls;

/// <summary>"2d6" inside a roll: how many dice of one type.</summary>
public readonly record struct DiceGroup(DieType Type, int Count);

/// <summary>
/// What a player asked to roll, with the groups in the order they typed them ("1d20 + 2d6").
/// <paramref name="Reason"/> is set when another mod rolls for the player ("Lazy"), and shows in the chat line.
/// A flat modifier ("+3") will be one more field here; nothing else in the request has to change for it.
/// </summary>
public sealed record RollRequest(PlayerId Roller, IReadOnlyList<DiceGroup> Groups, string? Reason = null);
