using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging.Abstractions;
using OblivionMp.ChatMod.Common;
using OblivionMp.ChatMod.Serverside;
using ReadyM.Api.Idents;
using ReadyM.Relay.Server.Sdk.Players;
using RpRoll.Server;
using RpRoll.Server.Rolls;
using Xunit;

namespace RpRoll.Tests;

/// <summary>
/// No input, however broken, and no failing consumer may stop /roll from working for the next roll.
/// </summary>
public class FailSafeTests
{
    private static readonly PlayerId Pete = default;

    private sealed class FakeChat : IChat
    {
        public readonly List<(PlayerId Player, string Text, ChatLineKind Kind)> Sent = new();

        public IReadOnlyList<ChatPlayer> ConnectedPlayers => Array.Empty<ChatPlayer>();

        public string GetNickname(PlayerId player) => "Pete";

        public void Broadcast(string text, ChatLineKind kind = ChatLineKind.System) => Sent.Add((default, text, kind));

        public void SendTo(PlayerId player, string text, ChatLineKind kind = ChatLineKind.System) => Sent.Add((player, text, kind));

        public void AddCommand(string name, string usage, ChatCommandHandler run)
        {
        }
    }

    private sealed class FakePlayers : IPlayers
    {
        public void Kick(PlayerId player)
        {
        }

        public Guid? GetReadyMId(PlayerId player) => null;
    }

    private static (RollCommand Command, RollService Rolls, FakeChat Chat) Build()
    {
        FakeChat chat = new();
        RollService rolls = new(new PlayerDiceSets(new FakePlayers()), NullLogger.Instance);
        return (new RollCommand(chat, rolls, new BoardLink(), NullLogger.Instance), rolls, chat);
    }

    [Fact]
    public void InvalidInputThenValidRoll()
    {
        (RollCommand command, RollService rolls, FakeChat chat) = Build();
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        command.Roll(chat, Pete, "abc");
        command.Roll(chat, Pete, "");

        Assert.Equal((Pete, RollNotation.UsageMessage, ChatLineKind.Rejection), chat.Sent[0]);
        Assert.Single(seen);
        Assert.Equal(DieType.D20, seen[0].Dice[0].Type);
    }

    /// <summary>Pete's in-game sequence from 16 and 17 Oct: every valid roll answers, abc gets the rejection.</summary>
    [Fact]
    public void PetesSequenceFromTheGame()
    {
        (RollCommand command, RollService rolls, FakeChat chat) = Build();
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        foreach (string input in new[] { "", "abc", "2d20", "", "1d20+2d6" })
        {
            Assert.Null(Record.Exception(() => command.Roll(chat, Pete, input)));
        }

        Assert.Equal(4, seen.Count);
        Assert.Equal("1d20", Notation(seen[0]));
        Assert.Equal("2d20", Notation(seen[1]));
        Assert.Equal("1d20", Notation(seen[2]));
        Assert.Equal("1d20 + 2d6", Notation(seen[3]));
        Assert.Single(chat.Sent);
        Assert.Equal((Pete, RollNotation.UsageMessage, ChatLineKind.Rejection), chat.Sent[0]);
    }

    private static string Notation(RollResult result) =>
        string.Join(" + ", result.Groups.Select(g => $"{g.Count}d{(int)g.Type}"));

    [Fact]
    public void AFailingConsumerNeverEscapesTheCommandAndTheNextRollStillWorks()
    {
        (RollCommand command, RollService rolls, FakeChat chat) = Build();
        bool failNext = true;
        rolls.Rolled += _ =>
        {
            if (failNext)
            {
                failNext = false;
                throw new InvalidOperationException("consumer broke");
            }
        };
        List<RollResult> seen = new();
        rolls.Rolled += seen.Add;

        Exception? escaped = Record.Exception(() => command.Roll(chat, Pete, "2d6"));
        command.Roll(chat, Pete, "1d20");

        Assert.Null(escaped);
        Assert.Equal(2, seen.Count); // the second consumer got both rolls, even the one the first consumer broke on
    }

    [Fact]
    public void BrokenInputNeverThrows()
    {
        (RollCommand command, _, FakeChat chat) = Build();
        foreach (string input in new[] { "abc", "1d20+", "+", "99999999999999999999d6", "d", "1d", "\0", " d20", new string('9', 500) + "d6", "1d20+3" })
        {
            Assert.Null(Record.Exception(() => command.Roll(chat, Pete, input)));
        }
        Assert.All(chat.Sent, line => Assert.Equal(ChatLineKind.Rejection, line.Kind));
    }

    [Theory]
    [InlineData(true, true, false, true)]
    [InlineData(true, true, true, false)] // chat window open: the line is already in chat, no HUD message
    [InlineData(false, true, false, false)]
    [InlineData(true, false, false, false)]
    public void HudShowsRollsOnlyWhenChatIsClosed(bool fromServer, bool isAction, bool chatOpen, bool expected)
    {
        Assert.Equal(expected, RpRoll.Client.RollLineFilter.ShouldShowOnHud(fromServer, isAction, "Pete rolled 1d20: d20 [14] = 14", chatOpen));
    }
}
