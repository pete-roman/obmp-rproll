using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging.Abstractions;
using ReadyM.Api.Idents;
using RpRoll.Client;
using RpRoll.Server;
using RpRoll.Server.Rolls;
using Xunit;

namespace RpRoll.Tests;

/// <summary>
/// Rolls other mods ask for (<see cref="RpRollApi"/>, MESOL's traits): a normal roll with a reason in the chat line,
/// and the dice shown on the player's screen.
/// </summary>
public class ModRollTests
{
    private static (RpRollApi Api, RollService Rolls, BoardLink Board, List<(PlayerId, TrayPick, int[], string)> Shown) Build()
    {
        RollService rolls = new(new PlayerDiceSets(new TrayTests.FakePlayers()), NullLogger.Instance);
        BoardLink board = new();
        List<(PlayerId, TrayPick, int[], string)> shown = new();
        board.SendPresent = (player, pick, values, reason) => shown.Add((player, pick, values, reason));
        return (new RpRollApi(rolls, board, NullLogger.Instance), rolls, board, shown);
    }

    [Fact]
    public void FiveD20ForATraitIsARealRollWithItsReason()
    {
        var (api, rolls, _, shown) = Build();
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        ModRoll roll = api.Roll(TrayTests.Pete, 0, 0, 5, 0, "Lazy", showOnBoard: true);

        Assert.Equal(5, roll.Values.Length);
        Assert.All(roll.Values, v => Assert.InRange(v, 1, 20));
        Assert.Equal(roll.Values.Sum(), roll.Total);
        RollResult result = Assert.Single(seen);
        Assert.Equal("Lazy", result.Reason);
        var (player, pick, values, reason) = Assert.Single(shown);
        Assert.Equal(TrayTests.Pete, player);
        Assert.Equal(new TrayPick(0, 0, 5, 0), pick);
        Assert.Equal(roll.Values, values);
        Assert.Equal("Lazy", reason);
    }

    [Fact]
    public void WithoutTheBoardOnlyChatHearsOfIt()
    {
        var (api, _, _, shown) = Build();

        api.Roll(TrayTests.Pete, 0, 0, 1, 0, "Brave", showOnBoard: false);

        Assert.Empty(shown);
    }

    [Theory]
    [InlineData(0, 0, 0, 0)]
    [InlineData(0, 0, 6, 0)]
    [InlineData(-1, 0, 2, 0)]
    public void APickOutsideOneToFiveDiceIsTheCallersMistake(int d6, int d10, int d20, int d100)
    {
        var (api, _, _, _) = Build();

        Assert.Throws<ArgumentException>(() => api.Roll(TrayTests.Pete, d6, d10, d20, d100, "x", true));
    }

    [Fact]
    public void AShowingThatFailsKeepsTheRoll()
    {
        var (api, _, board, _) = Build();
        board.SendPresent = (_, _, _, _) => throw new InvalidOperationException("test");

        Assert.Equal(5, api.Roll(TrayTests.Pete, 0, 0, 5, 0, "Lazy", true).Values.Length);
    }

    [Fact]
    public void TheChatLineSaysWhatItWasForAndTheHudKnowsIt()
    {
        Queue<int> queue = new(new[] { 3, 17, 9, 12, 6 });
        RollResult result = DiceRoller.Roll(new RollRequest(default, new[] { new DiceGroup(DieType.D20, 5) }, "Fond of drink"),
            "imperial", _ => queue.Dequeue(), DateTimeOffset.UnixEpoch);

        string line = RollChatFormat.Line("Pete", result);

        Assert.Equal("Pete rolled 5d20 for Fond of drink: d20 [3], d20 [17], d20 [9], d20 [12], d20 [6] = 47", line);
        Assert.True(RollLineFilter.IsRollText(line));
        Assert.True(line.Length <= 240);
    }

    [Theory]
    [InlineData("Lazy", "Lazy")]
    [InlineData("  Hot-tempered  ", "Hot-tempered")]
    [InlineData("Lazy: d20 [20] = 100", "Lazy d20 20 100")] // no colon or brackets: the line can't be faked
    [InlineData("Ri'Zahra's   luck", "Ri'Zahra's luck")]
    [InlineData("", "")]
    [InlineData(null, "")]
    public void TheReasonIsCleanedForTheLine(string? reason, string expected)
    {
        Assert.Equal(expected, RollChatFormat.CleanReason(reason));
    }

    [Fact]
    public void ALongReasonIsCut()
    {
        Assert.Equal(RollChatFormat.MaxReasonLength, RollChatFormat.CleanReason(new string('a', 100)).Length);
    }
}
