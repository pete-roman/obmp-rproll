using System;
using Microsoft.Extensions.Logging;
using OblivionMp.ChatMod;
using OblivionMp.ChatMod.Common;
using OblivionMp.Sdk;
using OblivionMpCSharpMod;
using ReadyM.Api.Idents;
using ReadyM.SDK.Attributes;

namespace RpRoll.Client;

/// <summary>
/// Listens to chat's <see cref="IChat.LineReceived"/> (no RPC of our own) and shows roll results in the
/// game's native HUD, so they are visible without the CEF chat window. Chat raises the event on the game
/// thread for every delivered line, whether or not its window can open.
/// </summary>
[Service]
public sealed partial class RollHud(IChat chat, IUserInterface ui, DiceTray tray, ILogger logger)
{
    private const float SecondsOnScreen = 5f;

    private void Start()
    {
        chat.LineReceived += OnChatLine;
        logger.LogInformation("[RpRoll] Listening for roll results on chat's LineReceived.");
    }

    private void Stop()
    {
        chat.LineReceived -= OnChatLine;
    }

    // Runs inside chat's own delivery of every line, so nothing may escape from here into chat.
    private void OnChatLine(ChatLine line)
    {
        try
        {
            // Rolls come from the server as Action lines. A player's own message is a Player line with their id,
            // and /me is a server Action line starting with "* ", which the filter rejects. The dice board
            // gets its numbers through RpRollRpc instead; only this HUD message still reads chat text.
            bool fromServer = line.Sender == PlayerId.Server;
            bool isAction = line.Kind == ChatLineKind.Action;
            bool chatOpen = chat.IsOpen;
            if (!RollLineFilter.ShouldShowOnHud(fromServer, isAction, line.Text, chatOpen))
            {
                if (chatOpen && fromServer && isAction && RollLineFilter.IsRollText(line.Text))
                {
                    logger.LogInformation("[RpRoll] Chat is open, roll left to chat only: {Text}", line.Text);
                }
                return;
            }
            if (tray.IsOpen)
            {
                // The dice tray is on screen and shows its own roll; a HUD line over it would spoil the throw.
                return;
            }
            ui.ShowMessage(line.Text, MessagePosition.Center, SecondsOnScreen);
            logger.LogInformation("[RpRoll] HUD: {Text}", line.Text);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "[RpRoll] Showing a roll in the HUD failed.");
        }
    }
}
