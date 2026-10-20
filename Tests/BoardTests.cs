using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging.Abstractions;
using OblivionMp.ChatMod.Common;
using OblivionMp.ChatMod.Serverside;
using ReadyM.Api.Idents;
using RpRoll.Server;
using RpRoll.Server.Rolls;
using Xunit;

namespace RpRoll.Tests;

/// <summary>
/// /roll and /board with the dice board open or closed (<see cref="RollCommand"/> and <see cref="BoardLink"/>).
/// </summary>
public class BoardTests
{
    private static readonly PlayerId Pete = TrayTests.Pete;

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

    private sealed class Setup
    {
        public readonly FakeChat Chat = new();
        public readonly BoardLink Board = new();
        public readonly List<RollResult> Rolled = new();
        public readonly List<(PlayerId, TrayPick)> Thrown = new();
        public readonly List<PlayerId> Toggled = new();
        public readonly RollCommand Command;

        public Setup()
        {
            RollService rolls = new(new PlayerDiceSets(new TrayTests.FakePlayers()), NullLogger.Instance);
            rolls.Rolled += Rolled.Add;
            Board.SendThrow = (p, pick) => Thrown.Add((p, pick));
            Board.SendToggle = Toggled.Add;
            Command = new RollCommand(Chat, rolls, Board, NullLogger.Instance);
        }
    }

    [Fact]
    public void WithTheBoardClosedRollIsAChatLineOnly()
    {
        Setup s = new();

        s.Command.Roll(s.Chat, Pete, "2d10");

        RollResult result = Assert.Single(s.Rolled);
        Assert.Equal(new[] { new DiceGroup(DieType.D10, 2) }, result.Groups);
        Assert.Empty(s.Thrown);
    }

    [Fact]
    public void WithTheBoardOpenRollWithoutArgumentsThrowsTheTray()
    {
        Setup s = new();
        s.Board.SetOpen(Pete, true);

        s.Command.Roll(s.Chat, Pete, "  ");

        Assert.Equal((Pete, TrayPick.AsInTray), Assert.Single(s.Thrown));
        Assert.Empty(s.Rolled); // rolled once, by the board's own request, not here as well
    }

    [Theory]
    [InlineData("2d10", 0, 2, 0, 0)]
    [InlineData("1d20+2d6", 2, 0, 1, 0)]
    [InlineData("d100 + d6 + d6", 2, 0, 0, 1)]
    [InlineData("1d6+1d10+1d20+1d100", 1, 1, 1, 1)]
    public void WithTheBoardOpenRollWithArgumentsSetsTheTrayAndThrows(string arguments, int d6, int d10, int d20, int d100)
    {
        Setup s = new();
        s.Board.SetOpen(Pete, true);

        s.Command.Roll(s.Chat, Pete, arguments);

        Assert.Equal((Pete, new TrayPick(d6, d10, d20, d100)), Assert.Single(s.Thrown));
        Assert.Empty(s.Rolled);
    }

    [Theory]
    [InlineData("6d6", RollNotation.TooManyMessage)]
    [InlineData("3d6+3d20", RollNotation.TooManyMessage)]
    [InlineData("d8", RollNotation.UsageMessage)]
    [InlineData("1d20+3", RollNotation.ModifierMessage)]
    public void WithTheBoardOpenABadRollIsRefusedAndNothingIsThrown(string arguments, string message)
    {
        Setup s = new();
        s.Board.SetOpen(Pete, true);

        s.Command.Roll(s.Chat, Pete, arguments);

        Assert.Empty(s.Thrown);
        Assert.Empty(s.Rolled);
        (PlayerId to, string text, ChatLineKind kind) = Assert.Single(s.Chat.Sent);
        Assert.Equal((Pete, message, ChatLineKind.Rejection), (to, text, kind));
    }

    [Fact]
    public void TheSixthDieIsRefusedTheSameWayWithTheBoardClosed()
    {
        Setup s = new();

        s.Command.Roll(s.Chat, Pete, "5d6+1d10");

        Assert.Empty(s.Rolled);
        Assert.Equal(RollNotation.TooManyMessage, Assert.Single(s.Chat.Sent).Text);
    }

    [Fact]
    public void ClosingTheBoardSendsRollBackToChat()
    {
        Setup s = new();
        s.Board.SetOpen(Pete, true);
        s.Board.SetOpen(Pete, false);

        s.Command.Roll(s.Chat, Pete, "");

        Assert.Single(s.Rolled);
        Assert.Empty(s.Thrown);
    }

    [Fact]
    public void BoardTogglesThePlayersBoard()
    {
        Setup s = new();

        s.Command.Board(s.Chat, Pete, "");
        s.Command.Board(s.Chat, Pete, "whatever");

        Assert.Equal(new[] { Pete, Pete }, s.Toggled);
    }

    [Fact]
    public void OnePlayersOpenBoardIsNotAnothers()
    {
        Setup s = new();
        s.Board.SetOpen(Pete, true);

        s.Command.Roll(s.Chat, TrayTests.Other, "1d20");

        Assert.Single(s.Rolled);
        Assert.Empty(s.Thrown);
    }

    [Fact]
    public void WithoutWiringNothingBreaks()
    {
        BoardLink board = new();
        board.SetOpen(Pete, true);

        board.Throw(Pete, TrayPick.AsInTray);
        board.Toggle(Pete);
    }
}
