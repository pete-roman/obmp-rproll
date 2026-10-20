using System;
using System.Collections.Generic;
using System.Linq;
using ReadyM.Api.Idents;
using RpRoll.Client;
using RpRoll.Server.Rolls;
using Xunit;

namespace RpRoll.Tests;

public class RollNotationTests
{
    [Theory]
    [InlineData("", "1d20")]
    [InlineData("   ", "1d20")]
    [InlineData("d20", "1d20")]
    [InlineData("2d6", "2d6")]
    [InlineData("d100", "1d100")]
    [InlineData("1d20+2d6", "1d20 + 2d6")]
    [InlineData(" 1d20 + 2d6 ", "1d20 + 2d6")]
    [InlineData("2D6", "2d6")]
    [InlineData("d6+d6+d20", "1d6 + 1d6 + 1d20")]
    [InlineData("5d6", "5d6")]
    [InlineData("2d6+3d20", "2d6 + 3d20")]
    [InlineData("d10", "1d10")]
    [InlineData("2d10+1d6", "2d10 + 1d6")]
    [InlineData("1d6+1d10+1d20+1d100", "1d6 + 1d10 + 1d20 + 1d100")]
    public void Accepts(string arguments, string expected)
    {
        Assert.True(RollNotation.TryParse(arguments, out IReadOnlyList<DiceGroup> groups, out string error));
        Assert.Equal(string.Empty, error);
        Assert.Equal(expected, string.Join(" + ", groups.Select(g => $"{g.Count}d{(int)g.Type}")));
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("d8")]
    [InlineData("1d4")]
    [InlineData("1d12")]
    [InlineData("d020")]
    [InlineData("0d6")]
    [InlineData("1d20+")]
    [InlineData("+1d20")]
    [InlineData("1d20 2d6")]
    [InlineData("1d20-2")]
    [InlineData("3")]
    [InlineData("-1d6")]
    public void RejectsWithUsage(string arguments)
    {
        Assert.False(RollNotation.TryParse(arguments, out _, out string error));
        Assert.Equal(RollNotation.UsageMessage, error);
    }

    [Theory]
    [InlineData("6d6")]
    [InlineData("3d6+3d20")]
    [InlineData("1d6+1d10+1d20+1d100+2d6")]
    [InlineData("99999999999d6")]
    public void RejectsMoreThanFiveDice(string arguments)
    {
        Assert.False(RollNotation.TryParse(arguments, out _, out string error));
        Assert.Equal(RollNotation.TooManyMessage, error);
    }

    [Theory]
    [InlineData("1d20+3")]
    [InlineData("2d6 + 1")]
    public void RejectsModifiersForNow(string arguments)
    {
        Assert.False(RollNotation.TryParse(arguments, out _, out string error));
        Assert.Equal(RollNotation.ModifierMessage, error);
    }

    [Fact]
    public void RejectionMessagesFitOneChatLine()
    {
        foreach (string message in new[] { RollNotation.UsageMessage, RollNotation.TooManyMessage, RollNotation.ModifierMessage })
        {
            Assert.True(message.Length <= 120, message);
        }
    }
}

public class DiceRollerTests
{
    private static readonly PlayerId Roller = default;

    private static readonly DateTimeOffset Now = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RollsEachDieInTypedOrderAndSums()
    {
        RollRequest request = new(Roller, new[] { new DiceGroup(DieType.D20, 1), new DiceGroup(DieType.D6, 2) });
        Queue<int> values = new(new[] { 14, 3, 5 });

        RollResult result = DiceRoller.Roll(request, "imperial", _ => values.Dequeue(), Now);

        Assert.Equal(new[] { new DieResult(DieType.D20, 14), new DieResult(DieType.D6, 3), new DieResult(DieType.D6, 5) }, result.Dice);
        Assert.Equal(22, result.Total);
        Assert.Equal("imperial", result.DiceSet);
        Assert.Equal(Now, result.RolledAt);
        Assert.Same(request.Groups, result.Groups);
    }

    [Fact]
    public void AsksTheRandomSourceForTheRightDie()
    {
        RollRequest request = new(Roller, new[] { new DiceGroup(DieType.D100, 1), new DiceGroup(DieType.D6, 1) });
        List<DieType> asked = new();

        DiceRoller.Roll(request, "imperial", type => { asked.Add(type); return 1; }, Now);

        Assert.Equal(new[] { DieType.D100, DieType.D6 }, asked);
    }
}

public class RollChatFormatTests
{
    private static RollResult Result(IReadOnlyList<DiceGroup> groups, params int[] values)
    {
        Queue<int> queue = new(values);
        return DiceRoller.Roll(new RollRequest(default, groups), "imperial", _ => queue.Dequeue(), DateTimeOffset.UnixEpoch);
    }

    [Fact]
    public void MixedRoll()
    {
        RollResult result = Result(new[] { new DiceGroup(DieType.D20, 1), new DiceGroup(DieType.D6, 2) }, 14, 3, 5);
        Assert.Equal("Pete rolled 1d20 + 2d6: d20 [14], d6 [3], d6 [5] = 22", RollChatFormat.Line("Pete", result));
    }

    [Fact]
    public void SingleDieUsesTheFullForm()
    {
        RollResult result = Result(new[] { new DiceGroup(DieType.D20, 1) }, 14);
        Assert.Equal("Pete rolled 1d20: d20 [14] = 14", RollChatFormat.Line("Pete", result));
    }

    [Fact]
    public void D10()
    {
        RollResult result = Result(new[] { new DiceGroup(DieType.D10, 2) }, 10, 3);
        Assert.Equal("Pete rolled 2d10: d10 [10], d10 [3] = 13", RollChatFormat.Line("Pete", result));
    }

    [Fact]
    public void D100()
    {
        RollResult result = Result(new[] { new DiceGroup(DieType.D100, 1), new DiceGroup(DieType.D10, 1) }, 80, 7);
        Assert.Equal("Pete rolled 1d100 + 1d10: d100 [80], d10 [7] = 87", RollChatFormat.Line("Pete", result));
    }

    [Fact]
    public void FiveD100FitsOneLine()
    {
        RollResult result = Result(new[] { new DiceGroup(DieType.D100, 5) }, Enumerable.Repeat(100, 5).ToArray());
        Assert.True(RollChatFormat.Line("A very long nickname here", result).Length <= 240);
    }

    [Theory]
    [InlineData("1d20")]
    [InlineData("2d6")]
    [InlineData("1d20+2d6")]
    [InlineData("d100+d100")]
    [InlineData("2d6+3d20")]
    [InlineData("2d10")]
    [InlineData("1d6+1d10+1d20+1d100")]
    public void HudRecognisesEveryLineTheServerSends(string arguments)
    {
        Assert.True(RollNotation.TryParse(arguments, out IReadOnlyList<DiceGroup> groups, out _));
        RollResult result = DiceRoller.Roll(new RollRequest(default, groups), "imperial", type => (int)type, DateTimeOffset.UnixEpoch);
        Assert.True(RollLineFilter.IsRollText(RollChatFormat.Line("Pete", result)));
    }
}

public class RollLineFilterTests
{
    [Theory]
    [InlineData("* Pete rolled 1d20: d20 [20] = 20")] // what "/me rolled 1d20: d20 [20] = 20" turns into
    [InlineData("pete rolls 2d6: 4 + 3 = 7")] // the old format
    [InlineData("Pete rolled 1d20: d20 [14] = 14 and wins")]
    [InlineData("Pete rolled 1d8: d8 [3] = 3")]
    [InlineData("rolled 1d20: d20 [14] = 14")]
    [InlineData("")]
    [InlineData(null)]
    public void IgnoresAnythingElse(string? text)
    {
        Assert.False(RollLineFilter.IsRollText(text));
    }

    [Fact]
    public void NameWithSpacesIsFine()
    {
        Assert.True(RollLineFilter.IsRollText("Sir Pete the Bold rolled 1d20: d20 [14] = 14"));
    }
}

public class DiceSetsTests
{
    [Fact]
    public void TwelveSetsWithImperialAsDefault()
    {
        Assert.Equal(12, DiceSets.All.Count);
        Assert.True(DiceSets.IsKnown(DiceSets.Default));
        Assert.Equal("imperial", DiceSets.Default);
        Assert.False(DiceSets.IsKnown("Imperial"));
    }
}
