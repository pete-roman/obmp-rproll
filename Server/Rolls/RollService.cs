using System;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using ReadyM.SDK.Attributes;

namespace RpRoll.Server.Rolls;

/// <summary>
/// The one place that rolls. Takes a <see cref="RollRequest"/>, returns a <see cref="RollResult"/> and raises
/// <see cref="Rolled"/> for every consumer: chat (<see cref="RollChat"/>) today, animation and UI later.
/// Rolls only ever happen here on the server, so a client can't pick its own numbers.
/// </summary>
[Service]
public sealed partial class RollService(PlayerDiceSets diceSets, ILogger logger)
{
    public event Action<RollResult>? Rolled;

    public RollResult Roll(RollRequest request)
    {
        RollResult result = DiceRoller.Roll(request, diceSets.Get(request.Roller), RollDie, DateTimeOffset.UtcNow);

        // Each consumer on its own: one that breaks is logged and the others still get the roll.
        Delegate[] consumers = Rolled?.GetInvocationList() ?? Array.Empty<Delegate>();
        foreach (Action<RollResult> consumer in consumers)
        {
            try
            {
                consumer(result);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "RpRoll: roll consumer {Consumer} failed; the other consumers still ran.",
                    consumer.Method.DeclaringType?.Name ?? consumer.Method.Name);
            }
        }
        return result;
    }

    // Cryptographic randomness: uniform and impossible to predict from earlier rolls. The d100 has ten faces,
    // 10 to 100.
    private static int RollDie(DieType type) => type == DieType.D100
        ? 10 * RandomNumberGenerator.GetInt32(1, 11)
        : RandomNumberGenerator.GetInt32(1, (int)type + 1);
}
