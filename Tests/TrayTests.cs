using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using ReadyM.Api.Idents;
using ReadyM.Api.Multiplayer;
using ReadyM.Relay.Server.Sdk.Players;
using RpRoll.Common;
using RpRoll.Server;
using RpRoll.Server.Rolls;
using Xunit;

namespace RpRoll.Tests;

/// <summary>
/// The dice board on the server: <see cref="TrayRolls"/>, which <see cref="RpRollRpcHandlers"/> calls for every
/// RollDice request (Space in game) and answers with its outcome.
/// </summary>
public class TrayTests
{
    internal static readonly PlayerId Pete = Player(1);
    internal static readonly PlayerId Other = Player(2);
    private static readonly DateTimeOffset T0 = new(2026, 10, 19, 12, 0, 0, TimeSpan.Zero);

    // PlayerId's constructor is internal to the SDK; the server hands them out in game.
    internal static PlayerId Player(ushort id) => (PlayerId)typeof(PlayerId)
        .GetConstructor(BindingFlags.NonPublic | BindingFlags.Instance, new[] { typeof(ushort) })!
        .Invoke(new object[] { id });

    internal sealed class FakePlayers : IPlayers
    {
        public int FailuresLeft;

        public void Kick(PlayerId player)
        {
        }

        public Guid? GetReadyMId(PlayerId player)
        {
            if (FailuresLeft > 0)
            {
                FailuresLeft--;
                throw new InvalidOperationException("test: player lookup failed");
            }
            return null;
        }
    }

    private static (TrayRolls Tray, RollService Rolls, FakePlayers Players) Build()
    {
        FakePlayers players = new();
        RollService rolls = new(new PlayerDiceSets(players), NullLogger.Instance);
        return (new TrayRolls(rolls, NullLogger.Instance), rolls, players);
    }

    private static TrayPick D20 => new(0, 0, 1, 0);

    [Fact]
    public void OneD20GoesThroughTheRollServiceSoChatShowsIt()
    {
        (TrayRolls tray, RollService rolls, _) = Build();
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        TrayOutcome outcome = tray.Roll(Pete, D20, T0);

        Assert.True(outcome.Accepted);
        int value = Assert.Single(outcome.Values);
        Assert.InRange(value, 1, 20);
        RollResult result = Assert.Single(seen);
        Assert.Equal(Pete, result.Roller);
        Assert.Equal(new[] { new DiceGroup(DieType.D20, 1) }, result.Groups);
        // What the client animates is exactly what chat prints.
        Assert.Equal(value, Assert.Single(result.Dice).Value);
    }

    [Fact]
    public void AllFourKindsComeBackInTrayOrderWithTheirRanges()
    {
        (TrayRolls tray, RollService rolls, _) = Build();
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        TrayOutcome outcome = tray.Roll(Pete, new TrayPick(1, 2, 1, 1), T0);

        Assert.True(outcome.Accepted);
        RollResult result = Assert.Single(seen);
        Assert.Equal(new[] { new DiceGroup(DieType.D6, 1), new DiceGroup(DieType.D10, 2), new DiceGroup(DieType.D20, 1), new DiceGroup(DieType.D100, 1) }, result.Groups);
        Assert.Equal(new[] { DieType.D6, DieType.D10, DieType.D10, DieType.D20, DieType.D100 }, result.Dice.Select(d => d.Type));
        Assert.Equal(result.Dice.Select(d => d.Value), outcome.Values);
        Assert.InRange(outcome.Values[0], 1, 6);
        Assert.All(outcome.Values.Skip(1).Take(2), v => Assert.InRange(v, 1, 10));
        Assert.InRange(outcome.Values[3], 1, 20);
        Assert.Contains(outcome.Values[4], Enumerable.Range(1, 10).Select(i => i * 10));
        Assert.Equal(outcome.Values.Sum(), result.Total);
    }

    [Theory]
    [InlineData(0, 0, 0, 0)]
    [InlineData(6, 0, 0, 0)]
    [InlineData(0, 0, 0, 6)]
    [InlineData(2, 2, 2, 0)]
    [InlineData(1, 1, 1, 3)]
    [InlineData(-1, 2, 0, 0)]
    [InlineData(1, -1, 1, 0)]
    [InlineData(0, 0, 0, int.MaxValue)]
    [InlineData(int.MinValue, 3, 3, 0)]
    [InlineData(int.MaxValue, int.MaxValue, 0, 0)]
    public void OnlyOneToFiveDiceAreRolled(int d6, int d10, int d20, int d100)
    {
        (TrayRolls tray, RollService rolls, _) = Build();
        int rolled = 0;
        rolls.Rolled += _ => rolled++;

        TrayOutcome outcome = tray.Roll(Pete, new TrayPick(d6, d10, d20, d100), T0);

        Assert.False(outcome.Accepted);
        Assert.Equal(TrayRolls.InvalidMessage, outcome.Reason);
        Assert.Empty(outcome.Values);
        Assert.Equal(0, rolled);
        // a refused pick costs no cooldown
        Assert.True(tray.Roll(Pete, new TrayPick(0, 5, 0, 0), T0).Accepted);
    }

    [Fact]
    public void ThrowingAgainWhileTheDiceRollIsRefusedWithoutRolling()
    {
        (TrayRolls tray, RollService rolls, _) = Build();
        int rolled = 0;
        rolls.Rolled += _ => rolled++;

        Assert.True(tray.Roll(Pete, D20, T0).Accepted);
        TrayOutcome tooSoon = tray.Roll(Pete, new TrayPick(2, 0, 0, 0), T0 + TrayRolls.Cooldown - TimeSpan.FromMilliseconds(1));

        Assert.False(tooSoon.Accepted);
        Assert.Equal(TrayRolls.TooSoonMessage, tooSoon.Reason);
        Assert.Equal(1, rolled);
        Assert.True(tray.Roll(Pete, new TrayPick(2, 0, 0, 0), T0 + TrayRolls.Cooldown).Accepted);
        Assert.Equal(2, rolled);
    }

    [Fact]
    public void OnePlayersCooldownDoesNotBlockAnother()
    {
        (TrayRolls tray, _, _) = Build();

        Assert.True(tray.Roll(Pete, D20, T0).Accepted);
        Assert.True(tray.Roll(Other, D20, T0).Accepted);
    }

    [Fact]
    public void AFailingRollIsRefusedAndTheNextOneWorks()
    {
        (TrayRolls tray, _, FakePlayers players) = Build();
        players.FailuresLeft = 1;

        TrayOutcome failed = tray.Roll(Pete, D20, T0);
        TrayOutcome next = tray.Roll(Pete, D20, T0 + TrayRolls.Cooldown);

        Assert.False(failed.Accepted);
        Assert.Equal(TrayRolls.FailedMessage, failed.Reason);
        Assert.True(next.Accepted);
    }

    [Fact]
    public void AThrowingRollConsumerDoesNotCostThePlayerTheirRoll()
    {
        (TrayRolls tray, RollService rolls, _) = Build();
        rolls.Rolled += _ => throw new InvalidOperationException("test: consumer broke");

        TrayOutcome outcome = tray.Roll(Pete, new TrayPick(3, 0, 0, 0), T0);

        Assert.True(outcome.Accepted);
        Assert.Equal(3, outcome.Values.Length);
    }

    [Theory]
    [InlineData(1, 0, 0, 0, 6, 1)]
    [InlineData(0, 1, 0, 0, 10, 1)]
    [InlineData(0, 0, 1, 0, 20, 1)]
    [InlineData(0, 0, 0, 1, 10, 10)]
    public void EveryFaceComesUpAndNothingOutsideTheDie(int d6, int d10, int d20, int d100, int sides, int step)
    {
        (TrayRolls tray, _, _) = Build();
        int[] faces = Enumerable.Range(1, sides).Select(i => i * step).ToArray();
        Dictionary<int, int> counts = faces.ToDictionary(f => f, _ => 0);
        int throws = sides * 200;

        for (int i = 0; i < throws; i++)
        {
            TrayOutcome outcome = tray.Roll(Pete, new TrayPick(d6, d10, d20, d100), T0 + TrayRolls.Cooldown * i);
            Assert.True(outcome.Accepted);
            int v = Assert.Single(outcome.Values);
            Assert.Contains(v, faces);
            counts[v]++;
        }

        // 200 expected per face; below 100 would mean a broken die, not bad luck. Every face is reachable: 1..sides,
        // and 10, 20 ... 100 on the d100.
        Assert.All(faces, face => Assert.InRange(counts[face], 100, 320));
    }

    [Fact]
    public void TheContractOnlyUsesServerMessages()
    {
        // [ClientToClients] relies on ServerRpcManifest.ClientOffset, which OB:MP 1.0 never assigns.
        MethodInfo[] contracts = typeof(RpRollRpc).GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Where(m => m.DeclaringType == typeof(RpRollRpc))
            .ToArray();

        Assert.Equal(new[] { "BoardState", "DiceRefused", "DiceRolled", "PresentRoll", "RollDice", "ToggleBoard", "TrayThrow" },
            contracts.Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));
        Assert.DoesNotContain(contracts, m => m.GetCustomAttribute<ClientToClientsAttribute>() is not null);
        foreach (string up in new[] { "RollDice", "BoardState" })
        {
            Assert.NotNull(typeof(RpRollRpc).GetMethod(up)!.GetCustomAttribute<ClientToServerAttribute>());
        }
        foreach (string down in new[] { "DiceRolled", "DiceRefused", "ToggleBoard", "TrayThrow", "PresentRoll" })
        {
            Assert.NotNull(typeof(RpRollRpc).GetMethod(down)!.GetCustomAttribute<ServerToClientAttribute>());
        }
        Assert.Equal(0, ServerRpcManifest.TotalClientEventCount);
    }
}
